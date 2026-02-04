import { SSMClient, GetParameterCommand, PutParameterCommand } from '@aws-sdk/client-ssm'
import { readFile, writeFile } from 'fs/promises'
import chalk from 'chalk'
import ora from 'ora'

const DEFAULT_PARAM_NAME = '/bedrock-chatbot/config'

/**
 * Get SSM client with optional region/profile from environment
 */
function getSSMClient() {
  const config = {}
  if (process.env.AWS_REGION) {
    config.region = process.env.AWS_REGION
  }
  return new SSMClient(config)
}

/**
 * Get configuration parameter name from env or use default
 */
function getParameterName() {
  return process.env.CONFIG_PARAM_NAME || DEFAULT_PARAM_NAME
}

/**
 * Fetch configuration from SSM Parameter Store
 */
export async function getConfig() {
  const spinner = ora('Fetching configuration from SSM...').start()
  const ssm = getSSMClient()
  const paramName = getParameterName()

  try {
    const response = await ssm.send(
      new GetParameterCommand({
        Name: paramName,
        WithDecryption: true,
      }),
    )

    if (!response.Parameter?.Value) {
      spinner.fail('No configuration found')
      throw new Error('Parameter has no value')
    }

    const config = JSON.parse(response.Parameter.Value)
    spinner.succeed(`Configuration loaded from ${chalk.cyan(paramName)}`)
    return config
  } catch (error) {
    spinner.fail('Failed to fetch configuration')
    if (error.name === 'ParameterNotFound') {
      console.error(chalk.red(`\nParameter not found: ${paramName}`))
      console.error(chalk.yellow('Have you deployed the stack? Run: npm run deploy'))
    } else {
      console.error(chalk.red(`\nError: ${error.message}`))
    }
    throw error
  }
}

/**
 * Update configuration in SSM Parameter Store
 */
export async function updateConfig(configValue) {
  const spinner = ora('Updating configuration...').start()
  const ssm = getSSMClient()
  const paramName = getParameterName()

  try {
    await ssm.send(
      new PutParameterCommand({
        Name: paramName,
        Value: typeof configValue === 'string' ? configValue : JSON.stringify(configValue, null, 2),
        Overwrite: true,
        Type: 'String',
      }),
    )

    spinner.succeed(`Configuration updated in ${chalk.cyan(paramName)}`)
    console.log(chalk.yellow('\n⏱  Changes will take effect within 5 minutes (cache TTL)'))
    return true
  } catch (error) {
    spinner.fail('Failed to update configuration')
    console.error(chalk.red(`\nError: ${error.message}`))
    throw error
  }
}

/**
 * Known model provider patterns for validation
 */
const MODEL_PATTERNS = {
  anthropic: /^anthropic\.claude-/,
  amazon: /^amazon\.(titan|nova)-/,
  meta: /^meta\.llama/,
  cohere: /^cohere\.(command|embed)-/,
  mistral: /^mistral\./,
  ai21: /^ai21\./,
  deepseek: /^deepseek\./,
}

/**
 * Validate model ID format
 * @param {string} modelId - The model ID to validate
 * @returns {string|null} Error message if invalid, null if valid
 */
export function validateModelId(modelId) {
  if (!modelId || typeof modelId !== 'string') {
    return 'modelId must be a non-empty string'
  }

  const isKnownProvider = Object.values(MODEL_PATTERNS).some((pattern) => pattern.test(modelId))
  if (!isKnownProvider) {
    return `Unknown model provider for modelId: ${modelId}. Expected patterns: anthropic.*, amazon.*, meta.*, cohere.*, mistral.*, ai21.*, deepseek.*`
  }

  return null
}

/**
 * Validate generation parameters
 * @param {Object} config - The configuration object
 * @returns {string[]} Array of error messages
 */
export function validateGenerationParams(config) {
  const errors = []

  if (!config.generation) {
    return errors // Will be caught by required field validation
  }

  const { temperature, topP, maxTokens } = config.generation

  if (typeof temperature === 'number' && (temperature < 0 || temperature > 1)) {
    errors.push('generation.temperature must be between 0 and 1')
  }

  if (typeof topP === 'number' && (topP < 0 || topP > 1)) {
    errors.push('generation.topP must be between 0 and 1')
  }

  if (typeof maxTokens === 'number' && maxTokens < 1) {
    errors.push('generation.maxTokens must be at least 1')
  }

  return errors
}

/**
 * Validate configuration JSON
 */
export function validateConfig(config) {
  const requiredFields = [
    { path: 'model.modelId', type: 'string' },
    { path: 'knowledgeBase.enabled', type: 'boolean' },
    { path: 'knowledgeBase.knowledgeBaseId', type: 'string' },
    { path: 'prompts.systemWithContext', type: 'string' },
    { path: 'prompts.systemWithoutContext', type: 'string' },
    { path: 'prompts.contextTemplate', type: 'string' },
    { path: 'retrieval.numberOfResults', type: 'number' },
    { path: 'retrieval.maxContextLength', type: 'number' },
    { path: 'generation.maxTokens', type: 'number' },
    { path: 'generation.temperature', type: 'number' },
    { path: 'generation.topP', type: 'number' },
  ]

  const errors = []

  // Validate required fields and types
  for (const field of requiredFields) {
    const value = getNestedValue(config, field.path)
    if (value === undefined) {
      errors.push(`Missing required field: ${field.path}`)
    } else if (typeof value !== field.type) {
      errors.push(`Invalid type for ${field.path}: expected ${field.type}, got ${typeof value}`)
    }
  }

  // Validate model ID format (only if modelId exists and is a string)
  const modelId = getNestedValue(config, 'model.modelId')
  if (modelId && typeof modelId === 'string') {
    const modelError = validateModelId(modelId)
    if (modelError) {
      errors.push(modelError)
    }
  }

  // Validate generation parameter ranges
  const paramErrors = validateGenerationParams(config)
  errors.push(...paramErrors)

  return errors
}

/**
 * Get nested object value by path (e.g., 'model.modelId')
 */
function getNestedValue(obj, path) {
  return path.split('.').reduce((current, key) => current?.[key], obj)
}

/**
 * Set nested object value by path
 */
function setNestedValue(obj, path, value) {
  const keys = path.split('.')
  const lastKey = keys.pop()
  const target = keys.reduce((current, key) => {
    if (!(key in current)) {
      current[key] = {}
    }
    return current[key]
  }, obj)
  target[lastKey] = value
}

/**
 * Command: Get configuration
 */
export async function handleGet() {
  try {
    const config = await getConfig()
    console.log('\n' + JSON.stringify(config, null, 2))
    return config
  } catch {
    process.exit(1)
  }
}

/**
 * Command: Update configuration from file
 */
export async function handleUpdate(filePath) {
  const spinner = ora('Reading configuration file...').start()

  try {
    const fileContent = await readFile(filePath, 'utf-8')
    spinner.succeed(`Read ${chalk.cyan(filePath)}`)

    spinner.start('Validating JSON...')
    let config
    try {
      config = JSON.parse(fileContent)
    } catch (error) {
      spinner.fail('Invalid JSON')
      console.error(chalk.red(`\nJSON parse error: ${error.message}`))
      process.exit(1)
    }
    spinner.succeed('Valid JSON')

    spinner.start('Validating configuration schema...')
    const errors = validateConfig(config)
    if (errors.length > 0) {
      spinner.fail('Configuration validation failed')
      console.error(chalk.red('\nValidation errors:'))
      errors.forEach((err) => console.error(chalk.red(`  ✗ ${err}`)))
      process.exit(1)
    }
    spinner.succeed('Configuration is valid')

    await updateConfig(config)
    console.log(chalk.green('\n✓ Configuration updated successfully'))
  } catch (error) {
    if (error.code === 'ENOENT') {
      spinner.fail(`File not found: ${filePath}`)
    }
    process.exit(1)
  }
}

/**
 * Command: Set a specific configuration value
 */
export async function handleSet(key, value) {
  try {
    const config = await getConfig()

    const spinner = ora(`Setting ${chalk.cyan(key)} = ${chalk.yellow(value)}`).start()

    // Try to parse value as JSON, otherwise treat as string
    let parsedValue = value
    try {
      parsedValue = JSON.parse(value)
    } catch {
      // Keep as string
    }

    setNestedValue(config, key, parsedValue)

    // Validate after setting
    const errors = validateConfig(config)
    if (errors.length > 0) {
      spinner.fail('Invalid configuration after update')
      console.error(chalk.red('\nValidation errors:'))
      errors.forEach((err) => console.error(chalk.red(`  ✗ ${err}`)))
      process.exit(1)
    }

    spinner.stop()
    await updateConfig(config)
    console.log(
      chalk.green(`\n✓ Set ${chalk.cyan(key)} = ${chalk.yellow(JSON.stringify(parsedValue))}`),
    )
  } catch {
    process.exit(1)
  }
}

/**
 * Command: Validate a configuration file
 */
export async function handleValidate(filePath) {
  const spinner = ora('Reading configuration file...').start()

  try {
    const fileContent = await readFile(filePath, 'utf-8')
    spinner.succeed(`Read ${chalk.cyan(filePath)}`)

    spinner.start('Validating JSON...')
    let config
    try {
      config = JSON.parse(fileContent)
    } catch (error) {
      spinner.fail('Invalid JSON')
      console.error(chalk.red(`\nJSON parse error: ${error.message}`))
      process.exit(1)
    }
    spinner.succeed('Valid JSON')

    spinner.start('Validating configuration schema...')
    const errors = validateConfig(config)
    if (errors.length > 0) {
      spinner.fail('Configuration validation failed')
      console.error(chalk.red('\nValidation errors:'))
      errors.forEach((err) => console.error(chalk.red(`  ✗ ${err}`)))
      process.exit(1)
    }
    spinner.succeed('Configuration is valid')

    console.log(chalk.green('\n✓ Configuration file is valid'))
  } catch (error) {
    if (error.code === 'ENOENT') {
      spinner.fail(`File not found: ${filePath}`)
    }
    process.exit(1)
  }
}

/**
 * Command: Backup configuration to a file
 */
export async function handleBackup(filePath) {
  try {
    const config = await getConfig()

    const spinner = ora(`Writing backup to ${chalk.cyan(filePath)}...`).start()
    await writeFile(filePath, JSON.stringify(config, null, 2), 'utf-8')
    spinner.succeed(`Backup saved to ${chalk.cyan(filePath)}`)

    console.log(chalk.green('\n✓ Configuration backed up successfully'))
  } catch {
    process.exit(1)
  }
}

/**
 * Command: Restore configuration from a backup file
 */
export async function handleRestore(filePath) {
  console.log(chalk.yellow('\n⚠  This will overwrite the current configuration!'))
  console.log('Press Ctrl+C to cancel, or Enter to continue...')

  // Wait for user confirmation (simple implementation)
  await new Promise((resolve) => {
    process.stdin.once('data', resolve)
  })

  await handleValidate(filePath)
  await handleUpdate(filePath)
}

/**
 * Command: Reset configuration to defaults
 */
export async function handleReset() {
  console.log(chalk.yellow('\n⚠  This will reset configuration to defaults!'))
  console.log('Press Ctrl+C to cancel, or Enter to continue...')

  await new Promise((resolve) => {
    process.stdin.once('data', resolve)
  })

  const spinner = ora('Loading default configuration...').start()

  try {
    // Import the default config from the schema
    const { defaultConfig } = await import('../../../lambda/config-schema.js')
    spinner.succeed('Default configuration loaded')

    await updateConfig(defaultConfig)
    console.log(chalk.green('\n✓ Configuration reset to defaults'))
  } catch (error) {
    spinner.fail('Failed to load default configuration')
    console.error(chalk.red(`\nError: ${error.message}`))
    process.exit(1)
  }
}
