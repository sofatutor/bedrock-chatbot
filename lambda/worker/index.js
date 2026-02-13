const {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} = require('@aws-sdk/client-apigatewaymanagementapi')
const {
  BedrockRuntimeClient,
  ConverseStreamCommand,
  ConverseCommand,
} = require('@aws-sdk/client-bedrock-runtime')
const {
  BedrockAgentRuntimeClient,
  RetrieveCommand,
} = require('@aws-sdk/client-bedrock-agent-runtime')
const { DynamoDBClient, PutItemCommand, UpdateItemCommand } = require('@aws-sdk/client-dynamodb')
const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm')
const { defaultConfig } = require('../config-schema')

const ws = new ApiGatewayManagementApiClient({ endpoint: process.env.WS_API_ENDPOINT })
const bedrock = new BedrockRuntimeClient({})
const agentRt = new BedrockAgentRuntimeClient({})
const ddb = new DynamoDBClient({})
const ssm = new SSMClient({})

// Configuration cache (with TTL)
let configCache = null
let configCacheTime = 0
const CONFIG_CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

/**
 * Fetches configuration from SSM Parameter Store with caching
 * @returns {Promise<Object>} Configuration object
 */
async function getConfig() {
  const now = Date.now()

  // Return cached config if still valid
  if (configCache && now - configCacheTime < CONFIG_CACHE_TTL_MS) {
    return configCache
  }

  // Try to fetch from SSM, fall back to default config
  try {
    const paramName = process.env.CONFIG_PARAM_NAME || '/bedrock-chatbot/config'
    const response = await ssm.send(
      new GetParameterCommand({
        Name: paramName,
        WithDecryption: true,
      }),
    )

    if (response.Parameter && response.Parameter.Value) {
      const config = JSON.parse(response.Parameter.Value)
      configCache = config
      configCacheTime = now
      console.log('Configuration loaded from SSM')
      return config
    }
  } catch (error) {
    console.warn('Failed to load config from SSM, using defaults:', error.message)
  }

  // Fall back to default configuration
  configCache = defaultConfig
  configCacheTime = now
  return defaultConfig
}

async function streamMock({ connectionId, prompt }) {
  const demo = `Here's a streaming demo for your prompt: "${prompt}"\n\n- This is a mock response.\n- It streams tokens over WebSocket.\n- Deployed via CDK, served via CloudFront.\n\nEnjoy the demo!`
  let seq = 0
  for (const ch of demo.split('')) {
    await ws.send(
      new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: Buffer.from(JSON.stringify({ event: 'delta', seq: seq++, content: ch })),
      }),
    )
    await new Promise((r) => setTimeout(r, 10))
  }
  await ws.send(
    new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: Buffer.from(JSON.stringify({ event: 'complete' })),
    }),
  )
}

exports.handler = async (event) => {
  // Load configuration (cached)
  const config = await getConfig()

  for (const rec of event.Records) {
    const job = JSON.parse(rec.body)
    const { prompt, connectionId, sessionId } = job
    const userId = typeof job.userId === 'string' && job.userId.trim() ? job.userId.trim() : 'anonymous'

    // Determine Knowledge Base ID: config takes precedence over env var
    const knowledgeBaseId = config.knowledgeBase.enabled
      ? config.knowledgeBase.knowledgeBaseId
      : process.env.KNOWLEDGE_BASE_ID || ''

    // If explicitly forced to MOCK, stream mock data; otherwise use Bedrock.
    if (knowledgeBaseId === 'MOCK') {
      await streamMock({ connectionId, prompt })
      continue
    }

    // Optional KB retrieval when enabled and KB ID is provided
    let ctx = ''
    if (config.knowledgeBase.enabled && knowledgeBaseId) {
      try {
        const retrieved = await agentRt.send(
          new RetrieveCommand({
            knowledgeBaseId: knowledgeBaseId,
            retrievalQuery: { text: prompt },
            retrievalConfiguration: {
              vectorSearchConfiguration: {
                numberOfResults: config.retrieval.numberOfResults,
              },
            },
          }),
        )
        const items = retrieved.retrievalResults || []
        ctx = items
          .map(
            (x, i) => `[S${i + 1}] ${x.content?.text?.slice(0, config.retrieval.maxContextLength)}`,
          )
          .join('\n')
      } catch (e) {
        console.log('KB retrieve failed', e)
      }
    }

    // Use configured prompts
    const system = ctx ? config.prompts.systemWithContext : config.prompts.systemWithoutContext
    const user = ctx
      ? config.prompts.contextTemplate.replace('{context}', ctx).replace('{prompt}', prompt)
      : prompt

    // Build Converse API parameters (model-agnostic format)
    const converseParams = {
      modelId: config.model.modelId,
      messages: [{ role: 'user', content: [{ text: user }] }],
      system: [{ text: system }],
      inferenceConfig: {
        maxTokens: config.generation.maxTokens,
        temperature: config.generation.temperature,
        topP: config.generation.topP,
      },
    }

    // Add model-specific parameters if configured
    if (config.modelSpecific && Object.keys(config.modelSpecific).length > 0) {
      converseParams.additionalModelRequestFields = config.modelSpecific
    }

    const useProfile = process.env.INFERENCE_PROFILE_ARN && process.env.INFERENCE_PROFILE_ARN.trim()

    if (!useProfile) {
      // Streaming with ConverseStream API (model-agnostic)
      const cmd = new ConverseStreamCommand(converseParams)
      const resp = await bedrock.send(cmd)
      let seq = 0
      let assistantText = ''

      for await (const evt of resp.stream) {
        // Handle content block delta events (streaming text)
        if (evt.contentBlockDelta?.delta?.text) {
          const delta = evt.contentBlockDelta.delta.text
          assistantText += delta
          await ws.send(
            new PostToConnectionCommand({
              ConnectionId: connectionId,
              Data: Buffer.from(JSON.stringify({ event: 'delta', seq: seq++, content: delta })),
            }),
          )
        }
        // Handle message stop event (end of response)
        if (evt.messageStop) {
          break
        }
        // Handle errors in stream
        if (evt.internalServerException || evt.modelStreamErrorException) {
          const error = evt.internalServerException || evt.modelStreamErrorException
          console.log('Stream error:', error.message)
          throw new Error(error.message || 'Stream error')
        }
      }

      if (assistantText && sessionId) {
        const now = Date.now()
        const ttl = Math.floor(now / 1000) + 30 * 24 * 3600
        try {
          await ddb.send(
            new PutItemCommand({
              TableName: process.env.SESSION_TABLE,
              Item: {
                pk: { S: `SESSION#${sessionId}` },
                sk: { S: `MSG#${now}#assistant` },
                type: { S: 'message' },
                role: { S: 'assistant' },
                content: { S: assistantText },
                userId: { S: userId },
                ts: { N: String(now) },
                ttl: { N: String(ttl) },
              },
            }),
          )
          await ddb.send(
            new UpdateItemCommand({
              TableName: process.env.SESSION_TABLE,
              Key: { pk: { S: `USER#${userId}` }, sk: { S: `THREAD#${sessionId}` } },
              UpdateExpression: 'SET updatedAt = :u',
              ExpressionAttributeValues: { ':u': { N: String(now) } },
            }),
          )
        } catch (e) {
          console.log('assistant message store failed', e)
        }
      }

      await ws.send(
        new PostToConnectionCommand({
          ConnectionId: connectionId,
          Data: Buffer.from(JSON.stringify({ event: 'complete' })),
        }),
      )
    } else {
      // Fallback: non-streaming Converse API for inference profiles
      // Use the inference profile ARN as the modelId
      const profileParams = {
        ...converseParams,
        modelId: process.env.INFERENCE_PROFILE_ARN,
      }

      const resp = await bedrock.send(new ConverseCommand(profileParams))

      // Extract text from the response
      let out = ''
      if (resp.output?.message?.content) {
        for (const block of resp.output.message.content) {
          if (block.text) {
            out += block.text
          }
        }
      }

      // Stream the output in small chunks to client
      let seq = 0
      for (const ch of out.split('')) {
        await ws.send(
          new PostToConnectionCommand({
            ConnectionId: connectionId,
            Data: Buffer.from(JSON.stringify({ event: 'delta', seq: seq++, content: ch })),
          }),
        )
        await new Promise((r) => setTimeout(r, 5))
      }

      if (out && sessionId) {
        const now = Date.now()
        const ttl = Math.floor(now / 1000) + 30 * 24 * 3600
        try {
          await ddb.send(
            new PutItemCommand({
              TableName: process.env.SESSION_TABLE,
              Item: {
                pk: { S: `SESSION#${sessionId}` },
                sk: { S: `MSG#${now}#assistant` },
                type: { S: 'message' },
                role: { S: 'assistant' },
                content: { S: out },
                userId: { S: userId },
                ts: { N: String(now) },
                ttl: { N: String(ttl) },
              },
            }),
          )
          await ddb.send(
            new UpdateItemCommand({
              TableName: process.env.SESSION_TABLE,
              Key: { pk: { S: `USER#${userId}` }, sk: { S: `THREAD#${sessionId}` } },
              UpdateExpression: 'SET updatedAt = :u',
              ExpressionAttributeValues: { ':u': { N: String(now) } },
            }),
          )
        } catch (e) {
          console.log('assistant message store failed', e)
        }
      }

      await ws.send(
        new PostToConnectionCommand({
          ConnectionId: connectionId,
          Data: Buffer.from(JSON.stringify({ event: 'complete' })),
        }),
      )
    }
  }
}
