/**
 * Configuration schema for Bedrock Chatbot
 * This defines the structure of the configuration stored in SSM Parameter Store
 * Uses the Converse API for model-agnostic inference across all Bedrock models
 */

/**
 * @typedef {Object} ChatbotConfig
 * @property {ModelConfig} model - Model configuration
 * @property {KnowledgeBaseConfig} knowledgeBase - Knowledge Base configuration
 * @property {PromptConfig} prompts - System prompts configuration
 * @property {RetrievalConfig} retrieval - Knowledge base retrieval configuration
 * @property {GenerationConfig} generation - Generation parameters
 * @property {Object} modelSpecific - Optional model-specific parameters (passed as additionalModelRequestFields)
 */

/**
 * @typedef {Object} ModelConfig
 * @property {string} modelId - Bedrock model ID (e.g., anthropic.claude-3-5-sonnet-20240620-v1:0, amazon.titan-text-express-v1, meta.llama3-70b-instruct-v1:0)
 */

/**
 * @typedef {Object} KnowledgeBaseConfig
 * @property {boolean} enabled - Enable/disable Knowledge Base retrieval
 * @property {string} knowledgeBaseId - Knowledge Base ID (empty string if disabled)
 */

/**
 * @typedef {Object} PromptConfig
 * @property {string} systemWithContext - System prompt when context is available
 * @property {string} systemWithoutContext - System prompt when no context is available
 * @property {string} contextTemplate - Template for formatting context (use {context} and {prompt} placeholders)
 */

/**
 * @typedef {Object} RetrievalConfig
 * @property {number} numberOfResults - Number of documents to retrieve from Knowledge Base
 * @property {number} maxContextLength - Maximum length of each context snippet in characters
 */

/**
 * @typedef {Object} GenerationConfig
 * @property {number} maxTokens - Maximum tokens to generate
 * @property {number} temperature - Temperature for generation (0.0 to 1.0)
 * @property {number} topP - Top P sampling parameter
 */

/**
 * Default configuration
 * @type {ChatbotConfig}
 */
const defaultConfig = {
  model: {
    modelId: 'anthropic.claude-3-5-sonnet-20240620-v1:0',
  },
  knowledgeBase: {
    enabled: false,
    knowledgeBaseId: '',
  },
  prompts: {
    systemWithContext:
      "You are a helpful assistant. Use only the CONTEXT to answer and cite as [S#]. If unknown, say you don't know.",
    systemWithoutContext: 'You are a helpful assistant. Answer clearly and concisely.',
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

module.exports = {
  defaultConfig,
}
