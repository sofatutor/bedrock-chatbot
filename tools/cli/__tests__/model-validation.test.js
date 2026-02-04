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
    describe('known providers (no error, no warning)', () => {
      test.each([
        'anthropic.claude-3-5-sonnet-20240620-v1:0',
        'anthropic.claude-3-haiku-20240307-v1:0',
        'anthropic.claude-instant-v1',
        'amazon.titan-text-express-v1',
        'amazon.titan-text-lite-v1',
        'amazon.nova-micro-v1:0',
        'amazon.nova-lite-v1:0',
        'meta.llama3-70b-instruct-v1:0',
        'meta.llama2-13b-chat-v1',
        'cohere.command-r-plus-v1:0',
        'cohere.command-text-v14',
        'cohere.embed-english-v3',
        'mistral.mistral-large-2402-v1:0',
        'mistral.mixtral-8x7b-instruct-v0:1',
        'ai21.jamba-1-5-large-v1:0',
        'ai21.j2-ultra-v1',
        'deepseek.deepseek-r1-v1:0',
        'stability.sdxl-v1',
      ])('accepts known model ID %s without error or warning', (modelId) => {
        const result = validateModelId(modelId)
        expect(result.error).toBeNull()
        expect(result.warning).toBeNull()
      })
    })

    describe('unknown providers with valid format (warning only)', () => {
      test.each([
        'newprovider.model-v1',
        'openai.gpt-4',
        'custom.my-fine-tuned-model',
        'future.bedrock-model-2025',
      ])('accepts unknown provider %s with warning but no error', (modelId) => {
        const result = validateModelId(modelId)
        expect(result.error).toBeNull()
        expect(result.warning).not.toBeNull()
        expect(result.warning).toContain('Unknown model provider')
      })
    })

    describe('invalid format (error)', () => {
      test('returns error for model ID without dot separator', () => {
        const result = validateModelId('invalid-no-dot')
        expect(result.error).not.toBeNull()
        expect(result.error).toContain('Invalid modelId format')
        expect(result.warning).toBeNull()
      })

      test('returns error for empty string', () => {
        const result = validateModelId('')
        expect(result.error).not.toBeNull()
        expect(result.error).toContain('non-empty string')
      })

      test('returns error for null modelId', () => {
        const result = validateModelId(null)
        expect(result.error).not.toBeNull()
        expect(result.error).toContain('non-empty string')
      })

      test('returns error for undefined modelId', () => {
        const result = validateModelId(undefined)
        expect(result.error).not.toBeNull()
        expect(result.error).toContain('non-empty string')
      })

      test('returns error for non-string modelId', () => {
        const result = validateModelId(123)
        expect(result.error).not.toBeNull()
        expect(result.error).toContain('non-empty string')
      })

      test('returns error for model ID with only spaces', () => {
        const result = validateModelId('   ')
        expect(result.error).not.toBeNull()
      })
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

  describe('known providers pass without errors or warnings', () => {
    test.each([
      ['Anthropic Claude', 'anthropic.claude-3-5-sonnet-20240620-v1:0'],
      ['Amazon Titan', 'amazon.titan-text-express-v1'],
      ['Amazon Nova', 'amazon.nova-lite-v1:0'],
      ['Meta Llama', 'meta.llama3-70b-instruct-v1:0'],
      ['Cohere', 'cohere.command-r-plus-v1:0'],
      ['Mistral', 'mistral.mistral-large-2402-v1:0'],
      ['AI21', 'ai21.jamba-1-5-large-v1:0'],
      ['DeepSeek', 'deepseek.deepseek-r1-v1:0'],
      ['Stability', 'stability.sdxl-v1:0'],
    ])('validates %s model without errors or warnings', (providerName, modelId) => {
      const config = createValidConfig(modelId)
      const { errors, warnings } = validateConfig(config, { includeWarnings: true })
      expect(errors).toHaveLength(0)
      expect(warnings).toHaveLength(0)
    })
  })

  describe('unknown providers pass with warning (model-agnostic support)', () => {
    test('accepts unknown provider with valid format, shows warning', () => {
      const config = createValidConfig('newprovider.future-model-v1')
      const { errors, warnings } = validateConfig(config, { includeWarnings: true })
      expect(errors).toHaveLength(0)
      expect(warnings.length).toBeGreaterThan(0)
      expect(warnings.some((w) => w.includes('Unknown model provider'))).toBe(true)
    })

    test('accepts hypothetical future AWS provider', () => {
      const config = createValidConfig('futureprovider.ai-model-2026-v1')
      const { errors, warnings } = validateConfig(config, { includeWarnings: true })
      expect(errors).toHaveLength(0)
      // Warning is informational, not blocking
    })
  })

  describe('invalid model IDs fail with error', () => {
    test('rejects model ID without dot separator', () => {
      const config = createValidConfig('invalid-no-dot')
      const { errors } = validateConfig(config, { includeWarnings: true })
      expect(errors.length).toBeGreaterThan(0)
      expect(errors.some((e) => e.includes('Invalid modelId format'))).toBe(true)
    })
  })

  describe('parameter errors are reported alongside model warnings', () => {
    test('reports parameter error with unknown provider warning', () => {
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
      const { errors, warnings } = validateConfig(config, { includeWarnings: true })
      // Temperature error should be in errors
      expect(errors.some((err) => err.includes('temperature'))).toBe(true)
      // Unknown provider should be in warnings (not errors)
      expect(warnings.some((w) => w.includes('Unknown model provider'))).toBe(true)
    })
  })

  describe('backwards compatibility: errors-only mode', () => {
    test('returns only errors array by default', () => {
      const config = createValidConfig('anthropic.claude-3-5-sonnet-20240620-v1:0')
      const result = validateConfig(config)
      expect(Array.isArray(result)).toBe(true)
      expect(result).toHaveLength(0)
    })

    test('unknown provider does not appear in errors-only mode', () => {
      const config = createValidConfig('unknown.model-v1')
      const result = validateConfig(config)
      // Should not contain unknown provider error since it's now a warning
      expect(result.some((e) => e.includes('Unknown model provider'))).toBe(false)
    })
  })
})
