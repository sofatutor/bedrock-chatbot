import { jest } from '@jest/globals'

// Create mocks before any imports
const mockSend = jest.fn()
const mockSSMClient = jest.fn(() => ({
  send: mockSend,
}))

const mockOra = jest.fn(() => ({
  start: jest.fn().mockReturnThis(),
  succeed: jest.fn().mockReturnThis(),
  fail: jest.fn().mockReturnThis(),
  stop: jest.fn().mockReturnThis(),
}))

const mockChalk = new Proxy(
  {},
  {
    get: () => (str) => str,
  },
)

// Mock modules BEFORE importing anything else
jest.unstable_mockModule('@aws-sdk/client-ssm', () => ({
  SSMClient: mockSSMClient,
  GetParameterCommand: jest.fn((params) => params),
  PutParameterCommand: jest.fn((params) => params),
}))

jest.unstable_mockModule('chalk', () => ({
  default: mockChalk,
}))

jest.unstable_mockModule('ora', () => ({
  default: mockOra,
}))

// Mock fs/promises for file operations
jest.unstable_mockModule('fs/promises', () => ({
  readFile: jest.fn(),
  writeFile: jest.fn(),
}))

// Import after mocking
const { validateConfig } = await import('../lib/config.js')

describe('Config Module', () => {
  describe('validateConfig', () => {
    test('validates correct configuration', () => {
      const validConfig = {
        model: {
          modelId: 'anthropic.claude-3-5-sonnet-20240620-v1:0',
        },
        knowledgeBase: {
          enabled: false,
          knowledgeBaseId: '',
        },
        prompts: {
          systemWithContext: 'You are a helpful assistant.',
          systemWithoutContext: 'You are a helpful assistant.',
          contextTemplate: 'CONTEXT:\n{context}\n\nUSER: {prompt}',
        },
        retrieval: {
          numberOfResults: 6,
          maxContextLength: 1000,
        },
        generation: {
          maxTokens: 800,
          temperature: 0.2,
          topP: 0.9,
        },
        modelSpecific: {},
      }

      const errors = validateConfig(validConfig)
      expect(errors).toHaveLength(0)
    })

    test('detects missing model.modelId', () => {
      const invalidConfig = {
        model: {},
        knowledgeBase: {
          enabled: false,
          knowledgeBaseId: '',
        },
        prompts: {
          systemWithContext: 'test',
          systemWithoutContext: 'test',
          contextTemplate: 'test',
        },
        retrieval: {
          numberOfResults: 6,
          maxContextLength: 1000,
        },
        generation: {
          maxTokens: 800,
          temperature: 0.2,
          topP: 0.9,
        },
      }

      const errors = validateConfig(invalidConfig)
      expect(errors.length).toBeGreaterThan(0)
      expect(errors.some((err) => err.includes('model.modelId'))).toBe(true)
    })

    test('detects wrong type for generation.temperature', () => {
      const invalidConfig = {
        model: {
          modelId: 'anthropic.claude-3-5-sonnet-20240620-v1:0',
        },
        knowledgeBase: {
          enabled: false,
          knowledgeBaseId: '',
        },
        prompts: {
          systemWithContext: 'test',
          systemWithoutContext: 'test',
          contextTemplate: 'test',
        },
        retrieval: {
          numberOfResults: 6,
          maxContextLength: 1000,
        },
        generation: {
          maxTokens: 800,
          temperature: 'high', // Should be number
          topP: 0.9,
        },
      }

      const errors = validateConfig(invalidConfig)
      expect(errors.length).toBeGreaterThan(0)
      expect(errors.some((err) => err.includes('generation.temperature'))).toBe(true)
    })

    test('detects missing prompts section', () => {
      const invalidConfig = {
        model: {
          modelId: 'anthropic.claude-3-5-sonnet-20240620-v1:0',
        },
        knowledgeBase: {
          enabled: false,
          knowledgeBaseId: '',
        },
        retrieval: {
          numberOfResults: 6,
          maxContextLength: 1000,
        },
        generation: {
          maxTokens: 800,
          temperature: 0.2,
          topP: 0.9,
        },
      }

      const errors = validateConfig(invalidConfig)
      expect(errors.length).toBeGreaterThan(0)
      expect(errors.some((err) => err.includes('prompts'))).toBe(true)
    })

    test('detects multiple validation errors', () => {
      const invalidConfig = {
        model: {
          // missing modelId
        },
        prompts: {
          systemWithContext: 'test',
          // missing systemWithoutContext
          contextTemplate: 'test',
        },
        retrieval: {
          numberOfResults: 'six', // wrong type
          maxContextLength: 1000,
        },
        generation: {
          maxTokens: 800,
          temperature: 0.2,
          topP: 0.9,
        },
      }

      const errors = validateConfig(invalidConfig)
      expect(errors.length).toBeGreaterThanOrEqual(3)
    })

    test('validates all generation parameters', () => {
      const validConfig = {
        model: {
          modelId: 'anthropic.claude-3-5-sonnet-20240620-v1:0',
        },
        knowledgeBase: {
          enabled: true,
          knowledgeBaseId: 'my-kb-id',
        },
        prompts: {
          systemWithContext: 'test',
          systemWithoutContext: 'test',
          contextTemplate: 'test',
        },
        retrieval: {
          numberOfResults: 10,
          maxContextLength: 2000,
        },
        generation: {
          maxTokens: 1500,
          temperature: 0.7,
          topP: 0.95,
        },
      }

      const errors = validateConfig(validConfig)
      expect(errors).toHaveLength(0)
    })

    test('validates retrieval parameters', () => {
      const validConfig = {
        model: {
          modelId: 'amazon.titan-text-express-v1',
        },
        knowledgeBase: {
          enabled: false,
          knowledgeBaseId: '',
        },
        prompts: {
          systemWithContext: 'test',
          systemWithoutContext: 'test',
          contextTemplate: 'test',
        },
        retrieval: {
          numberOfResults: 20,
          maxContextLength: 5000,
        },
        generation: {
          maxTokens: 800,
          temperature: 0.2,
          topP: 0.9,
        },
      }

      const errors = validateConfig(validConfig)
      expect(errors).toHaveLength(0)
    })

    test('handles empty config object', () => {
      const errors = validateConfig({})
      expect(errors.length).toBeGreaterThan(0)
      // Should report all missing required fields (11 fields now)
      expect(errors.length).toBeGreaterThanOrEqual(11)
    })

    test('handles null values', () => {
      const invalidConfig = {
        model: {
          modelId: null,
        },
        knowledgeBase: {
          enabled: null,
          knowledgeBaseId: null,
        },
        prompts: {
          systemWithContext: null,
          systemWithoutContext: null,
          contextTemplate: null,
        },
        retrieval: {
          numberOfResults: null,
          maxContextLength: null,
        },
        generation: {
          maxTokens: null,
          temperature: null,
          topP: null,
        },
      }

      const errors = validateConfig(invalidConfig)
      expect(errors.length).toBeGreaterThan(0)
    })
  })

  describe('Configuration Integration', () => {
    let configModule

    beforeAll(async () => {
      configModule = await import('../lib/config.js')
    })

    beforeEach(() => {
      jest.clearAllMocks()
      mockSend.mockReset()
    })

    describe('getConfig', () => {
      test('fetches configuration from SSM successfully', async () => {
        const mockConfig = {
          model: {
            modelId: 'anthropic.claude-3-5-sonnet-20240620-v1:0',
          },
          knowledgeBase: {
            enabled: false,
            knowledgeBaseId: '',
          },
          prompts: {
            systemWithContext: 'test',
            systemWithoutContext: 'test',
            contextTemplate: 'test',
          },
          retrieval: {
            numberOfResults: 6,
            maxContextLength: 1000,
          },
          generation: {
            maxTokens: 800,
            temperature: 0.2,
            topP: 0.9,
          },
          modelSpecific: {},
        }

        mockSend.mockResolvedValueOnce({
          Parameter: {
            Value: JSON.stringify(mockConfig),
          },
        })

        const config = await configModule.getConfig()
        expect(config).toEqual(mockConfig)
        expect(mockSend).toHaveBeenCalledWith(
          expect.objectContaining({
            Name: '/bedrock-chatbot/config',
            WithDecryption: true,
          }),
        )
      })

      test('throws error when parameter not found', async () => {
        const error = new Error('Parameter not found')
        error.name = 'ParameterNotFound'
        mockSend.mockRejectedValueOnce(error)

        await expect(configModule.getConfig()).rejects.toThrow('Parameter not found')
        expect(mockSend).toHaveBeenCalled()
      })

      test('throws error when parameter has no value', async () => {
        mockSend.mockResolvedValueOnce({
          Parameter: {},
        })

        await expect(configModule.getConfig()).rejects.toThrow()
      })
    })

    describe('updateConfig', () => {
      test('updates configuration successfully with object', async () => {
        const newConfig = {
          model: { modelId: 'anthropic.claude-3-haiku-20240307-v1:0' },
          knowledgeBase: { enabled: true, knowledgeBaseId: 'my-kb' },
          prompts: {
            systemWithContext: 'new',
            systemWithoutContext: 'new',
            contextTemplate: 'new',
          },
          retrieval: { numberOfResults: 10, maxContextLength: 2000 },
          generation: { maxTokens: 1000, temperature: 0.5, topP: 0.95 },
          modelSpecific: {},
        }

        mockSend.mockResolvedValueOnce({})

        const result = await configModule.updateConfig(newConfig)
        expect(result).toBe(true)
        expect(mockSend).toHaveBeenCalledWith(
          expect.objectContaining({
            Name: '/bedrock-chatbot/config',
            Value: JSON.stringify(newConfig, null, 2),
            Overwrite: true,
          }),
        )
      })

      test('updates configuration successfully with string', async () => {
        const configString = '{"model":{"modelId":"test"}}'

        mockSend.mockResolvedValueOnce({})

        const result = await configModule.updateConfig(configString)
        expect(result).toBe(true)
        expect(mockSend).toHaveBeenCalledWith(
          expect.objectContaining({
            Name: '/bedrock-chatbot/config',
            Value: configString,
            Overwrite: true,
          }),
        )
      })

      test('throws error on update failure', async () => {
        mockSend.mockRejectedValueOnce(new Error('Access denied'))

        await expect(configModule.updateConfig({ test: 'config' })).rejects.toThrow('Access denied')
      })
    })
  })
})
