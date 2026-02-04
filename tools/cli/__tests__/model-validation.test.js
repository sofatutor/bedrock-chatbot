import { jest } from '@jest/globals'

// Create mocks before any imports
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
  SSMClient: jest.fn(() => ({ send: jest.fn() })),
  GetParameterCommand: jest.fn((params) => params),
  PutParameterCommand: jest.fn((params) => params),
}))

jest.unstable_mockModule('chalk', () => ({
  default: mockChalk,
}))

jest.unstable_mockModule('ora', () => ({
  default: mockOra,
}))

jest.unstable_mockModule('fs/promises', () => ({
  readFile: jest.fn(),
  writeFile: jest.fn(),
}))

// Import after mocking
const { validateModelId, validateGenerationParams, validateConfig } = await import('../lib/config.js')

describe('Model ID Validation', () => {
  describe('validateModelId', () => {
    test.each([
      ['anthropic.claude-3-5-sonnet-20240620-v1:0', true],
      ['anthropic.claude-3-haiku-20240307-v1:0', true],
      ['anthropic.claude-instant-v1', true],
      ['amazon.titan-text-express-v1', true],
      ['amazon.titan-text-lite-v1', true],
      ['amazon.nova-micro-v1:0', true],
      ['amazon.nova-lite-v1:0', true],
      ['meta.llama3-70b-instruct-v1:0', true],
      ['meta.llama2-13b-chat-v1', true],
      ['cohere.command-r-plus-v1:0', true],
      ['cohere.command-text-v14', true],
      ['cohere.embed-english-v3', true],
      ['mistral.mistral-large-2402-v1:0', true],
      ['mistral.mixtral-8x7b-instruct-v0:1', true],
      ['ai21.jamba-1-5-large-v1:0', true],
      ['ai21.j2-ultra-v1', true],
      ['deepseek.deepseek-r1-v1:0', true],
    ])('validates known model ID %s as valid', (modelId, isValid) => {
      const result = validateModelId(modelId)
      expect(result === null).toBe(isValid)
    })

    test.each([
      ['unknown.model-v1', false],
      ['invalid', false],
      ['openai.gpt-4', false],
      ['', false],
      ['random-string', false],
    ])('rejects unknown model ID %s', (modelId) => {
      const result = validateModelId(modelId)
      expect(result).not.toBeNull()
      expect(typeof result).toBe('string')
    })

    test('returns error for null modelId', () => {
      const result = validateModelId(null)
      expect(result).not.toBeNull()
      expect(result).toContain('non-empty string')
    })

    test('returns error for undefined modelId', () => {
      const result = validateModelId(undefined)
      expect(result).not.toBeNull()
      expect(result).toContain('non-empty string')
    })

    test('returns error for non-string modelId', () => {
      const result = validateModelId(123)
      expect(result).not.toBeNull()
      expect(result).toContain('non-empty string')
    })
  })
})

describe('Generation Parameter Validation', () => {
  describe('validateGenerationParams', () => {
    test('accepts valid parameters', () => {
      const config = {
        generation: {
          maxTokens: 800,
          temperature: 0.5,
          topP: 0.9,
        },
      }
      const errors = validateGenerationParams(config)
      expect(errors).toHaveLength(0)
    })

    test('accepts temperature at boundaries', () => {
      expect(validateGenerationParams({ generation: { temperature: 0 } })).toHaveLength(0)
      expect(validateGenerationParams({ generation: { temperature: 1 } })).toHaveLength(0)
    })

    test('accepts topP at boundaries', () => {
      expect(validateGenerationParams({ generation: { topP: 0 } })).toHaveLength(0)
      expect(validateGenerationParams({ generation: { topP: 1 } })).toHaveLength(0)
    })

    test('rejects temperature > 1', () => {
      const config = {
        generation: {
          maxTokens: 800,
          temperature: 1.5,
          topP: 0.9,
        },
      }
      const errors = validateGenerationParams(config)
      expect(errors.length).toBeGreaterThan(0)
      expect(errors.some((err) => err.includes('temperature'))).toBe(true)
    })

    test('rejects temperature < 0', () => {
      const config = {
        generation: {
          maxTokens: 800,
          temperature: -0.1,
          topP: 0.9,
        },
      }
      const errors = validateGenerationParams(config)
      expect(errors.length).toBeGreaterThan(0)
      expect(errors.some((err) => err.includes('temperature'))).toBe(true)
    })

    test('rejects topP > 1', () => {
      const config = {
        generation: {
          maxTokens: 800,
          temperature: 0.5,
          topP: 1.5,
        },
      }
      const errors = validateGenerationParams(config)
      expect(errors.length).toBeGreaterThan(0)
      expect(errors.some((err) => err.includes('topP'))).toBe(true)
    })

    test('rejects topP < 0', () => {
      const config = {
        generation: {
          maxTokens: 800,
          temperature: 0.5,
          topP: -0.1,
        },
      }
      const errors = validateGenerationParams(config)
      expect(errors.length).toBeGreaterThan(0)
      expect(errors.some((err) => err.includes('topP'))).toBe(true)
    })

    test('rejects maxTokens < 1', () => {
      const config = {
        generation: {
          maxTokens: 0,
          temperature: 0.5,
          topP: 0.9,
        },
      }
      const errors = validateGenerationParams(config)
      expect(errors.length).toBeGreaterThan(0)
      expect(errors.some((err) => err.includes('maxTokens'))).toBe(true)
    })

    test('rejects negative maxTokens', () => {
      const config = {
        generation: {
          maxTokens: -100,
          temperature: 0.5,
          topP: 0.9,
        },
      }
      const errors = validateGenerationParams(config)
      expect(errors.length).toBeGreaterThan(0)
      expect(errors.some((err) => err.includes('maxTokens'))).toBe(true)
    })

    test('returns empty array for missing generation section', () => {
      const config = {}
      const errors = validateGenerationParams(config)
      expect(errors).toHaveLength(0)
    })

    test('detects multiple validation errors', () => {
      const config = {
        generation: {
          maxTokens: 0,
          temperature: 2,
          topP: -1,
        },
      }
      const errors = validateGenerationParams(config)
      expect(errors.length).toBe(3)
    })
  })
})

describe('Cross-model Configuration Validation', () => {
  const createValidConfig = (modelId) => ({
    model: { modelId },
    knowledgeBase: { enabled: false, knowledgeBaseId: '' },
    prompts: {
      systemWithContext: 'test',
      systemWithoutContext: 'test',
      contextTemplate: 'test',
    },
    retrieval: { numberOfResults: 6, maxContextLength: 1000 },
    generation: { maxTokens: 800, temperature: 0.5, topP: 0.9 },
  })

  test('validates configuration with Anthropic Claude model', () => {
    const config = createValidConfig('anthropic.claude-3-5-sonnet-20240620-v1:0')
    const errors = validateConfig(config)
    expect(errors).toHaveLength(0)
  })

  test('validates configuration with Amazon Titan model', () => {
    const config = createValidConfig('amazon.titan-text-express-v1')
    const errors = validateConfig(config)
    expect(errors).toHaveLength(0)
  })

  test('validates configuration with Amazon Nova model', () => {
    const config = createValidConfig('amazon.nova-lite-v1:0')
    const errors = validateConfig(config)
    expect(errors).toHaveLength(0)
  })

  test('validates configuration with Meta Llama model', () => {
    const config = createValidConfig('meta.llama3-70b-instruct-v1:0')
    const errors = validateConfig(config)
    expect(errors).toHaveLength(0)
  })

  test('validates configuration with Cohere model', () => {
    const config = createValidConfig('cohere.command-r-plus-v1:0')
    const errors = validateConfig(config)
    expect(errors).toHaveLength(0)
  })

  test('validates configuration with Mistral model', () => {
    const config = createValidConfig('mistral.mistral-large-2402-v1:0')
    const errors = validateConfig(config)
    expect(errors).toHaveLength(0)
  })

  test('validates configuration with AI21 model', () => {
    const config = createValidConfig('ai21.jamba-1-5-large-v1:0')
    const errors = validateConfig(config)
    expect(errors).toHaveLength(0)
  })

  test('validates configuration with DeepSeek model', () => {
    const config = createValidConfig('deepseek.deepseek-r1-v1:0')
    const errors = validateConfig(config)
    expect(errors).toHaveLength(0)
  })

  test('rejects configuration with unknown model provider', () => {
    const config = createValidConfig('unknown.model-v1')
    const errors = validateConfig(config)
    expect(errors.length).toBeGreaterThan(0)
    expect(errors.some((err) => err.includes('Unknown model provider'))).toBe(true)
  })

  test('reports both model and parameter errors', () => {
    const config = {
      model: { modelId: 'unknown.model-v1' },
      knowledgeBase: { enabled: false, knowledgeBaseId: '' },
      prompts: {
        systemWithContext: 'test',
        systemWithoutContext: 'test',
        contextTemplate: 'test',
      },
      retrieval: { numberOfResults: 6, maxContextLength: 1000 },
      generation: { maxTokens: 800, temperature: 1.5, topP: 0.9 },
    }
    const errors = validateConfig(config)
    expect(errors.length).toBeGreaterThanOrEqual(2)
    expect(errors.some((err) => err.includes('Unknown model provider'))).toBe(true)
    expect(errors.some((err) => err.includes('temperature'))).toBe(true)
  })
})
