import 'source-map-support/register'
import * as cdk from 'aws-cdk-lib'
import { IdentityStack } from '../lib/identity-stack'
import { DataStack } from '../lib/data-stack'
import { ApiStack } from '../lib/api-stack'
import { FrontendStack } from '../lib/frontend-stack'

const app = new cdk.App()

const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION }

// Use prefix for shared AWS account visibility
const stackPrefix = 'BedrockChatbot-'
const resourcePrefix = 'BedrockChatbot-'

const identity = new IdentityStack(app, `${stackPrefix}IdentityStack`, {
  env,
  stackName: `${stackPrefix}IdentityStack`,
  resourcePrefix,
})

const data = new DataStack(app, `${stackPrefix}DataStack`, {
  env,
  stackName: `${stackPrefix}DataStack`,
  resourcePrefix,
})

new ApiStack(app, `${stackPrefix}ApiStack`, {
  env,
  stackName: `${stackPrefix}ApiStack`,
  resourcePrefix,
  userPool: identity.userPool,
  userPoolClient: identity.userPoolClient,
  sessionTable: data.sessionTable,
  policyTable: data.policyTable,
})

new FrontendStack(app, `${stackPrefix}FrontendStack`, {
  env,
  stackName: `${stackPrefix}FrontendStack`,
  resourcePrefix,
})
