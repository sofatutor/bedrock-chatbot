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
const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm')
const { defaultConfig } = require('../config-schema')

const ws = new ApiGatewayManagementApiClient({ endpoint: process.env.WS_API_ENDPOINT })
const bedrock = new BedrockRuntimeClient({})
const agentRt = new BedrockAgentRuntimeClient({})
const ssm = new SSMClient({})

// Models known not to support ConverseStream (persists across warm invocations)
const nonStreamingModels = new Set()

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

function normalizeMessagesToConverseFormat(messages, systemPrompt, userPrompt) {
  const normalized = Array.isArray(messages)
    ? messages
        .filter((m) => m && typeof m === 'object')
        .map((m) => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: [{ text: String(m.content || '') }],
        }))
        .filter((m) => m.content[0].text.trim().length > 0)
    : []

  const composedUser = `${systemPrompt}\n\n${userPrompt}`

  if (normalized.length > 0) {
    let lastUserIdx = -1
    for (let i = normalized.length - 1; i >= 0; i--) {
      if (normalized[i].role === 'user') {
        lastUserIdx = i
        break
      }
    }
    if (lastUserIdx >= 0) {
      normalized[lastUserIdx].content = [{ text: composedUser }]
    } else {
      normalized.push({ role: 'user', content: [{ text: composedUser }] })
    }
  }

  return normalized.length > 0
    ? normalized
    : [{ role: 'user', content: [{ text: composedUser }] }]
}

/**
 * Sends an error event to the WebSocket client
 * @param {string} connectionId - WebSocket connection ID
 * @param {string} message - Error message to send
 * @param {boolean} sendComplete - Whether to also send a complete event (defaults to true)
 */
async function sendErrorToClient(connectionId, message, sendComplete = true) {
  try {
    await ws.send(
      new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: Buffer.from(JSON.stringify({ event: 'error', message })),
      }),
    )
    if (sendComplete) {
      await ws.send(
        new PostToConnectionCommand({
          ConnectionId: connectionId,
          Data: Buffer.from(JSON.stringify({ event: 'complete' })),
        }),
      )
    }
  } catch (wsError) {
    console.error('Failed to send error to client:', wsError.message)
  }
}

/**
 * Sends a warning event to the WebSocket client (non-fatal)
 * @param {string} connectionId - WebSocket connection ID
 * @param {string} message - Warning message to send
 */
async function sendWarningToClient(connectionId, message) {
  try {
    await ws.send(
      new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: Buffer.from(JSON.stringify({ event: 'warning', message })),
      }),
    )
  } catch (wsError) {
    console.error('Failed to send warning to client:', wsError.message)
  }
}

/**
 * Converts AWS SDK errors to user-friendly messages
 * @param {Error} error - The error from AWS SDK
 * @returns {string} User-friendly error message
 */
function getClientFriendlyErrorMessage(error) {
  const errorName = error.name || ''
  const errorMessage = error.message || 'An unknown error occurred'

  // Map common Bedrock errors to user-friendly messages
  const errorMappings = {
    ThrottlingException: 'Service is temporarily busy. Please try again in a moment.',
    ServiceQuotaExceededException: 'Usage limit exceeded. Please try again later.',
    AccessDeniedException: 'Access denied. The model may not be enabled in your account.',
    ValidationException: `Invalid request: ${errorMessage}`,
    ResourceNotFoundException: 'The requested model or resource was not found.',
    ModelNotReadyException: 'The model is not ready. Please try again in a moment.',
    ModelTimeoutException: 'The request timed out. Please try with a shorter prompt.',
    ModelErrorException: 'The model encountered an error processing your request.',
    ServiceUnavailableException: 'Service temporarily unavailable. Please try again later.',
    InternalServerException: 'An internal error occurred. Please try again.',
  }

  // Check for known error types
  for (const [errorType, friendlyMessage] of Object.entries(errorMappings)) {
    if (errorName.includes(errorType) || errorMessage.includes(errorType)) {
      return friendlyMessage
    }
  }

  // For unrecognized errors, provide a generic message with some detail
  if (errorMessage.length > 200) {
    return `An error occurred: ${errorMessage.slice(0, 200)}...`
  }
  return `An error occurred: ${errorMessage}`
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
    const { prompt, connectionId } = job

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
      } catch (kbError) {
        console.error('KB retrieve failed:', kbError.message)
        // Notify client about KB failure (non-fatal, continue without context)
        await sendWarningToClient(
          connectionId,
          `Knowledge Base retrieval failed: ${kbError.message}. Proceeding without context.`,
        )
      }
    }

    // Use configured prompts
    const system = ctx ? config.prompts.systemWithContext : config.prompts.systemWithoutContext
    const user = ctx
      ? config.prompts.contextTemplate.replace('{context}', ctx).replace('{prompt}', prompt)
      : prompt

    // Resolve effective model ID: inference profile ARN takes precedence
    const effectiveModelId =
      (process.env.INFERENCE_PROFILE_ARN && process.env.INFERENCE_PROFILE_ARN.trim()) ||
      config.model.modelId

    // Build Converse API parameters (model-agnostic format)
    const converseParams = {
      modelId: effectiveModelId,
      messages: normalizeMessagesToConverseFormat(job.messages, system, user),
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

    let responded = false

    // Try streaming first (unless this model is known not to support it)
    if (!nonStreamingModels.has(effectiveModelId)) {
      try {
        const resp = await bedrock.send(new ConverseStreamCommand(converseParams))
        let seq = 0

        for await (const evt of resp.stream) {
          if (evt.contentBlockDelta?.delta?.text) {
            const delta = evt.contentBlockDelta.delta.text
            await ws.send(
              new PostToConnectionCommand({
                ConnectionId: connectionId,
                Data: Buffer.from(JSON.stringify({ event: 'delta', seq: seq++, content: delta })),
              }),
            )
          }
          if (evt.internalServerException || evt.modelStreamErrorException) {
            const error = evt.internalServerException || evt.modelStreamErrorException
            console.error('Stream error:', error.message)
            await sendErrorToClient(connectionId, error.message || 'Stream error occurred', false)
            break
          }
          if (evt.messageStop) {
            break
          }
        }

        await ws.send(
          new PostToConnectionCommand({
            ConnectionId: connectionId,
            Data: Buffer.from(JSON.stringify({ event: 'complete' })),
          }),
        )
        responded = true
      } catch (apiError) {
        const isStreamingUnsupported =
          apiError.name === 'ValidationException' &&
          apiError.message?.toLowerCase().includes('model identifier')
        if (isStreamingUnsupported) {
          nonStreamingModels.add(effectiveModelId)
          console.log(
            `Model ${effectiveModelId} does not support streaming, falling back to Converse`,
          )
        } else {
          console.error('Bedrock ConverseStream API call failed:', apiError.message)
          await sendErrorToClient(connectionId, getClientFriendlyErrorMessage(apiError))
          responded = true
        }
      }
    }

    // Non-streaming fallback
    if (!responded) {
      try {
        const resp = await bedrock.send(new ConverseCommand(converseParams))

        let out = ''
        if (resp.output?.message?.content) {
          for (const block of resp.output.message.content) {
            if (block.text) out += block.text
          }
        }

        // Send in word-sized chunks for a natural streaming feel
        const chunks = out.match(/\S+\s*/g) || [out]
        let seq = 0
        for (const chunk of chunks) {
          await ws.send(
            new PostToConnectionCommand({
              ConnectionId: connectionId,
              Data: Buffer.from(JSON.stringify({ event: 'delta', seq: seq++, content: chunk })),
            }),
          )
        }
        await ws.send(
          new PostToConnectionCommand({
            ConnectionId: connectionId,
            Data: Buffer.from(JSON.stringify({ event: 'complete' })),
          }),
        )
      } catch (apiError) {
        console.error('Bedrock Converse API call failed:', apiError.message)
        await sendErrorToClient(connectionId, getClientFriendlyErrorMessage(apiError))
      }
    }
  }
}
