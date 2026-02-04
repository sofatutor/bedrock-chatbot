import { Stack, StackProps, Duration, CfnOutput } from 'aws-cdk-lib'
import { Construct } from 'constructs'
import { Table } from 'aws-cdk-lib/aws-dynamodb'
import { IUserPool, IUserPoolClient } from 'aws-cdk-lib/aws-cognito'
import { Queue, QueueEncryption } from 'aws-cdk-lib/aws-sqs'
import { Runtime, Architecture } from 'aws-cdk-lib/aws-lambda'
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources'
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs'
import { HttpApi, HttpMethod, CorsHttpMethod } from '@aws-cdk/aws-apigatewayv2-alpha'
import { HttpLambdaIntegration } from '@aws-cdk/aws-apigatewayv2-integrations-alpha'
import { WebSocketApi, WebSocketStage } from '@aws-cdk/aws-apigatewayv2-alpha'
import { WebSocketLambdaIntegration } from '@aws-cdk/aws-apigatewayv2-integrations-alpha'
import { PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam'
import { StringParameter, ParameterTier } from 'aws-cdk-lib/aws-ssm'
import { join } from 'path'
import { defaultConfig } from '../../lambda/config-schema.js'

export interface ApiProps extends StackProps {
  resourcePrefix: string
  sessionTable: Table
  policyTable: Table
  userPool: IUserPool
  userPoolClient: IUserPoolClient
}

export class ApiStack extends Stack {
  public readonly restApiUrl: string
  public readonly wsEndpoint: string

  constructor(scope: Construct, id: string, props: ApiProps) {
    super(scope, id, props)

    // Create SSM Parameter with default configuration
    const configParamName = '/bedrock-chatbot/config'
    const configParam = new StringParameter(this, 'ChatbotConfig', {
      parameterName: configParamName,
      description: 'Bedrock Chatbot dynamic configuration (model, prompts, generation params)',
      stringValue: JSON.stringify(defaultConfig, null, 2),
      tier: ParameterTier.ADVANCED, // Advanced tier supports larger values (8KB vs 4KB)
    })

    const q = new Queue(this, 'RequestsQ', {
      queueName: `${props.resourcePrefix}RequestsQueue`,
      encryption: QueueEncryption.KMS_MANAGED,
      visibilityTimeout: Duration.minutes(5),
    })

    const onConnect = new NodejsFunction(this, 'WsOnConnect', {
      functionName: `${props.resourcePrefix}WsOnConnect`,
      runtime: Runtime.NODEJS_20_X,
      entry: join(__dirname, '../../lambda/websocket/onconnect/index.js'),
      handler: 'handler',
      architecture: Architecture.ARM_64,
      environment: { SESSION_TABLE: props.sessionTable.tableName },
      bundling: { minify: true, externalModules: [] },
    })
    const onDisconnect = new NodejsFunction(this, 'WsOnDisconnect', {
      functionName: `${props.resourcePrefix}WsOnDisconnect`,
      runtime: Runtime.NODEJS_20_X,
      entry: join(__dirname, '../../lambda/websocket/ondisconnect/index.js'),
      handler: 'handler',
      architecture: Architecture.ARM_64,
      environment: { SESSION_TABLE: props.sessionTable.tableName },
      bundling: { minify: true, externalModules: [] },
    })
    props.sessionTable.grantReadWriteData(onConnect)
    props.sessionTable.grantReadWriteData(onDisconnect)

    // Allow WS management calls from onConnect to post ack frames
    onConnect.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['execute-api:ManageConnections'],
        resources: ['*'],
      }),
    )

    const defaultFn = new NodejsFunction(this, 'WsDefault', {
      functionName: `${props.resourcePrefix}WsDefault`,
      runtime: Runtime.NODEJS_20_X,
      entry: join(__dirname, '../../lambda/websocket/default/index.js'),
      handler: 'handler',
      architecture: Architecture.ARM_64,
      bundling: { minify: true, externalModules: [] },
    })
    defaultFn.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['execute-api:ManageConnections'],
        resources: ['*'],
      }),
    )

    const wsApi = new WebSocketApi(this, 'ChatWsApi', {
      connectRouteOptions: { integration: new WebSocketLambdaIntegration('ConnectInt', onConnect) },
      disconnectRouteOptions: {
        integration: new WebSocketLambdaIntegration('DisconnectInt', onDisconnect),
      },
      defaultRouteOptions: { integration: new WebSocketLambdaIntegration('DefaultInt', defaultFn) },
    })
    const wsStage = new WebSocketStage(this, 'ProdWsStage', {
      webSocketApi: wsApi,
      stageName: 'prod',
      autoDeploy: true,
    })

    const enqueueFn = new NodejsFunction(this, 'EnqueueFn', {
      functionName: `${props.resourcePrefix}EnqueueFn`,
      runtime: Runtime.NODEJS_20_X,
      entry: join(__dirname, '../../lambda/enqueue/index.js'),
      handler: 'handler',
      architecture: Architecture.ARM_64,
      environment: {
        QUEUE_URL: q.queueUrl,
        SESSION_TABLE: props.sessionTable.tableName,
      },
      bundling: { minify: true, externalModules: [] },
    })
    q.grantSendMessages(enqueueFn)
    props.sessionTable.grantReadWriteData(enqueueFn)

    const httpApi = new HttpApi(this, 'ChatHttpApi', {
      corsPreflight: {
        allowOrigins: ['*'],
        allowMethods: [CorsHttpMethod.ANY],
        allowHeaders: ['*'],
      },
    })
    httpApi.addRoutes({
      path: '/chat',
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration('EnqueueInt', enqueueFn),
    })

    const workerFn = new NodejsFunction(this, 'WorkerFn', {
      functionName: `${props.resourcePrefix}WorkerFn`,
      runtime: Runtime.NODEJS_20_X,
      entry: join(__dirname, '../../lambda/worker/index.js'),
      handler: 'handler',
      timeout: Duration.minutes(5),
      memorySize: 1024,
      architecture: Architecture.ARM_64,
      environment: {
        SESSION_TABLE: props.sessionTable.tableName,
        WS_API_ENDPOINT: wsStage.callbackUrl.replace('wss://', 'https://'),
        INFERENCE_PROFILE_ARN: process.env.INFERENCE_PROFILE_ARN ?? '',
        KNOWLEDGE_BASE_ID: process.env.KNOWLEDGE_BASE_ID ?? '',
        CONFIG_PARAM_NAME: configParamName,
      },
      bundling: { minify: true, externalModules: [] },
    })
    q.grantConsumeMessages(workerFn)
    workerFn.addEventSource(new SqsEventSource(q, { batchSize: 1 }))
    props.sessionTable.grantReadWriteData(workerFn)

    // Grant read access to SSM parameter
    configParam.grantRead(workerFn)

    // IAM for WS and Bedrock
    workerFn.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['execute-api:ManageConnections'],
        resources: ['*'],
      }),
    )
    workerFn.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'bedrock:InvokeModel',
          'bedrock:InvokeModelWithResponseStream',
          'bedrock:Retrieve',
          'bedrock:RetrieveAndGenerate',
          'bedrock:RetrieveAndGenerateStream',
        ],
        resources: ['*'],
      }),
    )

    this.wsEndpoint = wsStage.url
    this.restApiUrl = httpApi.apiEndpoint

    new CfnOutput(this, 'WsEndpoint', {
      value: this.wsEndpoint,
      exportName: 'BedrockChatbot-WsEndpoint',
    })
    new CfnOutput(this, 'RestApiUrl', {
      value: this.restApiUrl,
      exportName: 'BedrockChatbot-RestApiUrl',
    })
    new CfnOutput(this, 'ConfigParamName', {
      value: configParamName,
      description: 'SSM Parameter name for chatbot configuration',
      exportName: 'BedrockChatbot-ConfigParamName',
    })
  }
}
