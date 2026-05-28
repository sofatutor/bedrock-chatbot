# Bedrock Chatbot

A **streaming LLM chat** application on AWS with **Amazon Bedrock** and **Knowledge Bases**.

## Features

- ✅ Real-time WebSocket streaming
- ✅ Async processing with SQS + Lambda
- ✅ RAG with Bedrock Knowledge Bases
- ✅ Dynamic configuration via SSM Parameter Store
- ✅ CDK v2 infrastructure as code
- ✅ CLI tool for configuration management

## Quick Start

1. **Install dependencies:**

   ```bash
   npm install
   cd cdk && npm install
   ```

2. **Deploy:**

   ```bash
   npm run deploy
   ```

   Set `KNOWLEDGE_BASE_ID` env var if using Knowledge Bases:

   ```bash
   KNOWLEDGE_BASE_ID=your-kb-id npm run deploy
   ```

3. **Get endpoints from outputs:**
   - `RestApiUrl` - HTTP API endpoint
   - `WsEndpoint` - WebSocket endpoint
   - `ConfigParamName` - SSM configuration parameter

4. **Configure frontend:**
   - Copy `frontend/config.sample.json` to `frontend/config.json`
   - Add your API endpoints
   - Open `frontend/index.html` in a browser

## Configuration Management

Update chatbot behavior without redeployment using the CLI:

```bash
# View configuration
npm run cli config get

# Update from file
npm run cli config update config.example.json

# Set specific values
npm run cli config set model.modelId "anthropic.claude-3-haiku-20240307-v1:0"
npm run cli config set generation.temperature 0.7

# Backup configuration
npm run cli config backup backup.json

# See all commands
npm run cli config --help
```

### Configurable Parameters

- **Model**: Model ID, API version
- **Knowledge Base**: Enable/disable, Knowledge Base ID
- **Prompts**: System prompts with/without context, context template
- **Retrieval**: Number of results, max context length
- **Generation**: Max tokens, temperature, top-p, top-k

See `config.example.json` for the full configuration structure.

**Note**: Knowledge Base ID can be set via configuration (preferred) or environment variable `KNOWLEDGE_BASE_ID` at deployment.

## Documentation

- [Architecture](docs/architecture.md) - System design and components
- [Deployment](docs/deployment.md) - Deployment guide
- [Configuration](docs/configuration.md) - Configuration management
- [IAM Policy Guide](docs/iam-policy-guide.md) - Required AWS permissions
- [Frontend](docs/frontend.md) - Frontend setup
- [POC](docs/poc.md) - Proof of concept notes

## Project Structure

```
bedrock-chatbot/
├── bin/
│   └── bedrock-chatbot      # CLI entry point
├── cdk/                     # CDK infrastructure
│   ├── bin/                 # CDK app
│   └── lib/                 # Stack definitions
├── lambda/                  # Lambda functions
│   ├── config-schema.js     # Configuration schema
│   ├── enqueue/             # HTTP request handler
│   ├── websocket/           # WebSocket handlers
│   └── worker/              # SQS worker
├── frontend/                # Web frontend
├── tools/
│   └── cli/                 # Configuration CLI tool
└── docs/                    # Documentation
```

## Development

```bash
# Run tests
npm test

# Run CLI tests
cd tools/cli && npm test

# Lint
npm run lint

# Format
npm run format
```

## License

MIT
