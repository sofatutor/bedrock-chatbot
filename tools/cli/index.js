#!/usr/bin/env node

import { Command } from 'commander'
import chalk from 'chalk'
import { readFile } from 'fs/promises'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import {
  handleGet,
  handleUpdate,
  handleSet,
  handleValidate,
  handleBackup,
  handleRestore,
  handleReset,
} from './lib/config.js'
import { handleOpen } from './lib/ui.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Read package.json for version
const packageJson = JSON.parse(await readFile(join(__dirname, 'package.json'), 'utf-8'))

const program = new Command()

program
  .name('bedrock-chatbot')
  .description('CLI tool for managing Bedrock Chatbot')
  .version(packageJson.version)
  .addHelpText(
    'after',
    `
${chalk.bold('Environment Variables:')}
  CONFIG_PARAM_NAME    SSM parameter name (default: /bedrock-chatbot/config)
  AWS_REGION           AWS region (optional)
  AWS_PROFILE          AWS profile (optional)

${chalk.bold('Examples:')}
  $ bedrock-chatbot config get
  $ bedrock-chatbot config update ./my-config.json
  $ bedrock-chatbot config set generation.temperature 0.5
  $ bedrock-chatbot config backup ./backup.json

${chalk.bold('Documentation:')}
  https://github.com/mfittko/bedrock-chatbot
`,
  )

// Config subcommand
const configCmd = program
  .command('config')
  .description('Manage chatbot configuration in SSM Parameter Store')

configCmd
  .command('get')
  .description('Display current configuration')
  .action(async () => {
    await handleGet()
  })

configCmd
  .command('update <file>')
  .description('Update configuration from JSON file')
  .action(async (file) => {
    await handleUpdate(file)
  })

configCmd
  .command('set <key> <value>')
  .description('Set a specific configuration value')
  .addHelpText(
    'after',
    `
${chalk.bold('Examples:')}
  $ bedrock-chatbot config set model.modelId "anthropic.claude-3-haiku-20240307-v1:0"
  $ bedrock-chatbot config set generation.temperature 0.7
  $ bedrock-chatbot config set generation.maxTokens 1500
`,
  )
  .action(async (key, value) => {
    await handleSet(key, value)
  })

configCmd
  .command('validate <file>')
  .description('Validate a configuration JSON file')
  .action(async (file) => {
    await handleValidate(file)
  })

configCmd
  .command('backup <file>')
  .description('Backup current configuration to a file')
  .action(async (file) => {
    await handleBackup(file)
  })

configCmd
  .command('restore <file>')
  .description('Restore configuration from a backup file')
  .action(async (file) => {
    await handleRestore(file)
  })

configCmd
  .command('reset')
  .description('Reset configuration to defaults')
  .action(async () => {
    await handleReset()
  })

// UI command
program
  .command('open')
  .description('Open the chatbot UI in browser with latest config')
  .action(async () => {
    await handleOpen()
  })

// Parse arguments
program.parse()
