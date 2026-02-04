/**
 * Worker Lambda Handler Tests
 * Tests for model-agnostic ConverseStream API integration
 */

import { jest } from '@jest/globals'

// Mock environment variables
process.env.WS_API_ENDPOINT = 'https://test.execute-api.us-east-1.amazonaws.com'
process.env.CONFIG_PARAM_NAME = '/bedrock-chatbot/config'

// Create mock implementations
const mockPostToConnection = jest.fn().mockResolvedValue({})
const mockConverseStreamSend = jest.fn()
const mockConverseSend = jest.fn()
const mockRetrieveSend = jest.fn()
const mockSSMSend = jest.fn()

// Mock AWS SDK modules
jest.unstable_mockModule('@aws-sdk/client-apigatewaymanagementapi', () => ({
  ApiGatewayManagementApiClient: jest.fn(() => ({
    send: mockPostToConnection,
  })),
  PostToConnectionCommand: jest.fn((params) => ({ ...params, _type: 'PostToConnection' })),
}))

jest.unstable_mockModule('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: jest.fn(() => ({
    send: jest.fn((cmd) => {
      if (cmd._type === 'ConverseStream') {
        return mockConverseStreamSend(cmd)
      }
      if (cmd._type === 'Converse') {
        return mockConverseSend(cmd)
      }
      throw new Error('Unknown command')
    }),
  })),
  ConverseStreamCommand: jest.fn((params) => ({ ...params, _type: 'ConverseStream' })),
  ConverseCommand: jest.fn((params) => ({ ...params, _type: 'Converse' })),
}))

jest.unstable_mockModule('@aws-sdk/client-bedrock-agent-runtime', () => ({
  BedrockAgentRuntimeClient: jest.fn(() => ({
    send: mockRetrieveSend,
  })),
  RetrieveCommand: jest.fn((params) => params),
}))

jest.unstable_mockModule('@aws-sdk/client-ssm', () => ({
  SSMClient: jest.fn(() => ({
    send: mockSSMSend,
  })),
  GetParameterCommand: jest.fn((params) => params),
}))

// Helper to create async iterable stream for ConverseStream responses
function createMockStream(events) {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const event of events) {
        yield event
      }
    },
  }
}

describe('Worker Lambda Handler', () => {
  let handler

  const defaultConfig = {
    model: {
      modelId: 'anthropic.claude-3-5-sonnet-20240620-v1:0',
    },
    knowledgeBase: {
      enabled: false,
      knowledgeBaseId: '',
    },
    prompts: {
      systemWithContext: 'You are helpful with context.',
      systemWithoutContext: 'You are helpful.',
      contextTemplate: 'CONTEXT:\n{context}\n\nUSER: {prompt}',
    },
    retrieval: {
      numberOfResults: 6,
      maxContextLength: 1000,
    },
    generation: {
      maxTokens: 800,
      temperature: 0.5,
      topP: 0.9,
    },
    modelSpecific: {},
  }

  const createSQSEvent = (prompt, connectionId = 'test-connection-id') => ({
    Records: [
      {
        body: JSON.stringify({ prompt, connectionId }),
      },
    ],
  })

  beforeEach(async () => {
    jest.clearAllMocks()

    // Mock SSM to return default config
    mockSSMSend.mockResolvedValue({
      Parameter: {
        Value: JSON.stringify(defaultConfig),
      },
    })

    // Re-import handler to reset module state (config cache)
    const module = await import('../index.js')
    handler = module.handler
  })

  describe('ConverseStream API Integration', () => {
    test('constructs correct ConverseStream parameters for Claude model', async () => {
      const streamEvents = [
        { contentBlockDelta: { delta: { text: 'Hello' } } },
        { contentBlockDelta: { delta: { text: ' world' } } },
        { messageStop: { stopReason: 'end_turn' } },
      ]

      mockConverseStreamSend.mockResolvedValue({
        stream: createMockStream(streamEvents),
      })

      await handler(createSQSEvent('Test prompt'))

      // Verify ConverseStreamCommand was called with correct structure
      const { ConverseStreamCommand } = await import('@aws-sdk/client-bedrock-runtime')
      expect(ConverseStreamCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          modelId: 'anthropic.claude-3-5-sonnet-20240620-v1:0',
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: 'user',
              content: expect.arrayContaining([expect.objectContaining({ text: expect.any(String) })]),
            }),
          ]),
          system: expect.arrayContaining([expect.objectContaining({ text: expect.any(String) })]),
          inferenceConfig: expect.objectContaining({
            maxTokens: 800,
            temperature: 0.5,
            topP: 0.9,
          }),
        }),
      )
    })

    test('streams text deltas to WebSocket connection', async () => {
      const streamEvents = [
        { contentBlockDelta: { delta: { text: 'Hello' } } },
        { contentBlockDelta: { delta: { text: ' world' } } },
        { messageStop: { stopReason: 'end_turn' } },
      ]

      mockConverseStreamSend.mockResolvedValue({
        stream: createMockStream(streamEvents),
      })

      await handler(createSQSEvent('Test prompt'))

      // Verify deltas were sent
      const postCalls = mockPostToConnection.mock.calls
      expect(postCalls.length).toBeGreaterThanOrEqual(3) // At least 2 deltas + complete

      // Check delta events
      const deltaMessages = postCalls
        .map((call) => JSON.parse(Buffer.from(call[0].Data).toString()))
        .filter((msg) => msg.event === 'delta')

      expect(deltaMessages).toHaveLength(2)
      expect(deltaMessages[0].content).toBe('Hello')
      expect(deltaMessages[1].content).toBe(' world')

      // Check complete event
      const completeMessage = postCalls
        .map((call) => JSON.parse(Buffer.from(call[0].Data).toString()))
        .find((msg) => msg.event === 'complete')

      expect(completeMessage).toBeDefined()
    })

    test('handles stream errors gracefully', async () => {
      const streamEvents = [
        { contentBlockDelta: { delta: { text: 'Partial' } } },
        { modelStreamErrorException: { message: 'Model error' } },
      ]

      mockConverseStreamSend.mockResolvedValue({
        stream: createMockStream(streamEvents),
      })

      await expect(handler(createSQSEvent('Test prompt'))).rejects.toThrow('Model error')
    })
  })

  describe('Model-Specific Configuration', () => {
    test('includes additionalModelRequestFields when modelSpecific is set', async () => {
      const configWithModelSpecific = {
        ...defaultConfig,
        modelSpecific: {
          top_k: 250,
          custom_param: 'value',
        },
      }

      mockSSMSend.mockResolvedValue({
        Parameter: {
          Value: JSON.stringify(configWithModelSpecific),
        },
      })

      const streamEvents = [
        { contentBlockDelta: { delta: { text: 'Response' } } },
        { messageStop: { stopReason: 'end_turn' } },
      ]

      mockConverseStreamSend.mockResolvedValue({
        stream: createMockStream(streamEvents),
      })

      // Re-import to clear config cache
      const module = await import('../index.js')
      await module.handler(createSQSEvent('Test'))

      const { ConverseStreamCommand } = await import('@aws-sdk/client-bedrock-runtime')
      expect(ConverseStreamCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          additionalModelRequestFields: {
            top_k: 250,
            custom_param: 'value',
          },
        }),
      )
    })

    test('works with Amazon Titan model configuration', async () => {
      const titanConfig = {
        ...defaultConfig,
        model: { modelId: 'amazon.titan-text-express-v1' },
      }

      mockSSMSend.mockResolvedValue({
        Parameter: {
          Value: JSON.stringify(titanConfig),
        },
      })

      const streamEvents = [
        { contentBlockDelta: { delta: { text: 'Titan response' } } },
        { messageStop: { stopReason: 'end_turn' } },
      ]

      mockConverseStreamSend.mockResolvedValue({
        stream: createMockStream(streamEvents),
      })

      const module = await import('../index.js')
      await module.handler(createSQSEvent('Test'))

      const { ConverseStreamCommand } = await import('@aws-sdk/client-bedrock-runtime')
      expect(ConverseStreamCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          modelId: 'amazon.titan-text-express-v1',
        }),
      )
    })

    test('works with Meta Llama model configuration', async () => {
      const llamaConfig = {
        ...defaultConfig,
        model: { modelId: 'meta.llama3-70b-instruct-v1:0' },
      }

      mockSSMSend.mockResolvedValue({
        Parameter: {
          Value: JSON.stringify(llamaConfig),
        },
      })

      const streamEvents = [
        { contentBlockDelta: { delta: { text: 'Llama response' } } },
        { messageStop: { stopReason: 'end_turn' } },
      ]

      mockConverseStreamSend.mockResolvedValue({
        stream: createMockStream(streamEvents),
      })

      const module = await import('../index.js')
      await module.handler(createSQSEvent('Test'))

      const { ConverseStreamCommand } = await import('@aws-sdk/client-bedrock-runtime')
      expect(ConverseStreamCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          modelId: 'meta.llama3-70b-instruct-v1:0',
        }),
      )
    })
  })

  describe('Knowledge Base Integration', () => {
    test('retrieves context when Knowledge Base is enabled', async () => {
      const kbConfig = {
        ...defaultConfig,
        knowledgeBase: {
          enabled: true,
          knowledgeBaseId: 'test-kb-id',
        },
      }

      mockSSMSend.mockResolvedValue({
        Parameter: {
          Value: JSON.stringify(kbConfig),
        },
      })

      mockRetrieveSend.mockResolvedValue({
        retrievalResults: [
          { content: { text: 'Retrieved context 1' } },
          { content: { text: 'Retrieved context 2' } },
        ],
      })

      const streamEvents = [
        { contentBlockDelta: { delta: { text: 'Response with context' } } },
        { messageStop: { stopReason: 'end_turn' } },
      ]

      mockConverseStreamSend.mockResolvedValue({
        stream: createMockStream(streamEvents),
      })

      const module = await import('../index.js')
      await module.handler(createSQSEvent('Test query'))

      // Verify KB retrieval was called
      expect(mockRetrieveSend).toHaveBeenCalled()
    })

    test('uses systemWithContext prompt when KB retrieval succeeds', async () => {
      const kbConfig = {
        ...defaultConfig,
        knowledgeBase: {
          enabled: true,
          knowledgeBaseId: 'test-kb-id',
        },
      }

      mockSSMSend.mockResolvedValue({
        Parameter: {
          Value: JSON.stringify(kbConfig),
        },
      })

      mockRetrieveSend.mockResolvedValue({
        retrievalResults: [{ content: { text: 'Context' } }],
      })

      const streamEvents = [
        { contentBlockDelta: { delta: { text: 'Response' } } },
        { messageStop: { stopReason: 'end_turn' } },
      ]

      mockConverseStreamSend.mockResolvedValue({
        stream: createMockStream(streamEvents),
      })

      const module = await import('../index.js')
      await module.handler(createSQSEvent('Test'))

      const { ConverseStreamCommand } = await import('@aws-sdk/client-bedrock-runtime')
      expect(ConverseStreamCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          system: expect.arrayContaining([
            expect.objectContaining({
              text: 'You are helpful with context.',
            }),
          ]),
        }),
      )
    })
  })

  describe('Mock Mode', () => {
    test('streams mock response when KB ID is MOCK', async () => {
      const mockConfig = {
        ...defaultConfig,
        knowledgeBase: {
          enabled: true,
          knowledgeBaseId: 'MOCK',
        },
      }

      mockSSMSend.mockResolvedValue({
        Parameter: {
          Value: JSON.stringify(mockConfig),
        },
      })

      const module = await import('../index.js')
      await module.handler(createSQSEvent('Test'))

      // Should NOT call Bedrock in mock mode
      expect(mockConverseStreamSend).not.toHaveBeenCalled()

      // Should send mock response via WebSocket
      expect(mockPostToConnection).toHaveBeenCalled()

      // Verify complete event was sent
      const completeMessage = mockPostToConnection.mock.calls
        .map((call) => JSON.parse(Buffer.from(call[0].Data).toString()))
        .find((msg) => msg.event === 'complete')

      expect(completeMessage).toBeDefined()
    })
  })

  describe('Inference Profile Fallback', () => {
    test('uses ConverseCommand when inference profile ARN is set', async () => {
      process.env.INFERENCE_PROFILE_ARN = 'arn:aws:bedrock:us-east-1:123456789:inference-profile/test'

      mockConverseSend.mockResolvedValue({
        output: {
          message: {
            content: [{ text: 'Non-streaming response' }],
          },
        },
      })

      const module = await import('../index.js')
      await module.handler(createSQSEvent('Test'))

      // Verify ConverseCommand (non-streaming) was called
      const { ConverseCommand } = await import('@aws-sdk/client-bedrock-runtime')
      expect(ConverseCommand).toHaveBeenCalled()

      // Clean up
      delete process.env.INFERENCE_PROFILE_ARN
    })
  })
})
