import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation'
import ora from 'ora'
import chalk from 'chalk'
import open from 'open'

const region = process.env.AWS_REGION || 'eu-central-1'

/**
 * Get stack outputs from CloudFormation
 */
async function getStackOutputs(stackName) {
  const client = new CloudFormationClient({ region })
  const command = new DescribeStacksCommand({ StackName: stackName })

  try {
    const response = await client.send(command)
    const outputs = response.Stacks[0].Outputs || []
    return outputs.reduce((acc, output) => {
      acc[output.OutputKey] = output.OutputValue
      return acc
    }, {})
  } catch (error) {
    throw new Error(`Failed to get stack outputs: ${error.message}`)
  }
}

/**
 * Open the chatbot UI in browser with endpoints as URL parameters
 */
export async function handleOpen() {
  const spinner = ora('Loading stack information...').start()

  try {
    // Get API stack outputs
    const apiOutputs = await getStackOutputs('BedrockChatbot-ApiStack')
    const restApiUrl = apiOutputs.RestApiUrl
    const wsEndpoint = apiOutputs.WsEndpoint

    if (!restApiUrl || !wsEndpoint) {
      spinner.fail('Missing API endpoints in BedrockChatbot-ApiStack outputs')
      console.log(chalk.yellow('\nMake sure the BedrockChatbot-ApiStack is deployed with outputs:'))
      console.log('  - RestApiUrl')
      console.log('  - WsEndpoint')
      process.exit(1)
    }

    // Get frontend stack outputs
    spinner.text = 'Getting frontend URL...'
    const frontendOutputs = await getStackOutputs('BedrockChatbot-FrontendStack')
    const siteUrl = frontendOutputs.SiteUrl

    if (!siteUrl) {
      spinner.fail('Missing SiteUrl in BedrockChatbot-FrontendStack outputs')
      process.exit(1)
    }

    // Construct URL with query parameters
    const url = new URL(siteUrl)
    url.searchParams.set('rest', `${restApiUrl}/chat`)
    url.searchParams.set('ws', wsEndpoint)

    spinner.succeed('Configuration loaded')

    console.log(chalk.green('\n✓ Opening chatbot UI...'))
    console.log(chalk.dim(`  URL: ${siteUrl}`))
    console.log(chalk.dim(`  REST: ${restApiUrl}/chat`))
    console.log(chalk.dim(`  WebSocket: ${wsEndpoint}`))

    // Open browser with parameters
    await open(url.toString())
  } catch (error) {
    spinner.fail(`Failed to open UI: ${error.message}`)
    console.error(chalk.red('\nError details:'), error)
    process.exit(1)
  }
}
