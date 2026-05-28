# IAM Policy Guide for Bedrock Chatbot

This document explains the IAM permissions required to interact with resources created by the Bedrock Chatbot CDK stacks.

## Overview

The Bedrock Chatbot deploys four CDK stacks that create various AWS resources:

1. **DataStack** - DynamoDB tables and S3 buckets for data storage
2. **IdentityStack** - Cognito User Pool for authentication
3. **ApiStack** - Lambda functions, API Gateway, SQS, and SSM parameters
4. **FrontendStack** - S3 bucket and CloudFront distribution for the web UI

## Policy File

The complete IAM policy is available in [`iam-policy.json`](./iam-policy.json).

## Permission Breakdown

### 1. Lambda Functions (`BedrockChatbotLambdaPermissions`)

**Resources Created:**
- `WsOnConnect` - WebSocket connection handler
- `WsOnDisconnect` - WebSocket disconnection handler
- `WsDefault` - WebSocket default route handler
- `EnqueueFn` - HTTP API request enqueuer
- `WorkerFn` - Background worker for Bedrock inference

**Permissions:**
- Invoke, get, update, and list Lambda functions
- Manage function versions and aliases
- Required for: Testing, debugging, updating function code/config

### 2. DynamoDB Tables (`BedrockChatbotDynamoDBPermissions`)

**Resources Created:**
- `Sessions` table - Stores WebSocket connection and chat session data
- `Policies` table - Stores user-specific policies and permissions

**Permissions:**
- Full CRUD operations (Get, Put, Update, Delete, Query, Scan)
- Batch operations for efficiency
- Required for: Managing chat sessions, user data, debugging

### 3. SQS Queue (`BedrockChatbotSQSPermissions`)

**Resources Created:**
- `RequestsQueue` - Queues chat requests for async processing

**Permissions:**
- Send, receive, delete messages
- Get queue attributes and URL
- Purge queue (for testing/cleanup)
- Required for: Managing message flow, debugging, queue maintenance

### 4. SSM Parameters (`BedrockChatbotSSMParameterPermissions`)

**Resources Created:**
- `/bedrock-chatbot/config` - Dynamic configuration parameter

**Permissions:**
- Get, put, delete parameters
- View parameter history
- Required for: Using the CLI config tool, updating chatbot configuration

**Key Use Case:** The `bedrock-chatbot config` CLI requires these permissions to manage dynamic configuration (model, prompts, generation params, Knowledge Base settings).

### 5. S3 Buckets (`BedrockChatbotS3Permissions`)

**Resources Created:**
- Feedback bucket - Stores user feedback data
- Site bucket - Hosts the frontend static files

**Permissions:**
- Full object operations (Get, Put, Delete)
- List bucket contents
- View versioning
- Required for: Accessing feedback, updating frontend, debugging

### 6. API Gateway (`BedrockChatbotAPIGatewayPermissions`)

**Resources Created:**
- WebSocket API - Real-time bidirectional communication
- HTTP API - REST endpoint for chat requests

**Permissions:**
- Invoke APIs
- Manage WebSocket connections
- API configuration operations
- Required for: Testing APIs, managing connections, debugging

### 7. Cognito User Pool (`BedrockChatbotCognitoPermissions`)

**Resources Created:**
- User Pool - Authentication and user management
- User Pool Client - Web application client

**Permissions:**
- Admin user operations (create, get, update, delete)
- List and describe user pools
- **Condition:** Only applies to resources tagged with CloudFormation stack name `BedrockChatbot*`
- Required for: User management, testing authentication

### 8. CloudFront Distribution (`BedrockChatbotCloudFrontPermissions`)

**Resources Created:**
- CloudFront distribution - CDN for the frontend

**Permissions:**
- Get distribution info and config
- Create and manage cache invalidations
- Required for: Updating frontend, clearing CDN cache

### 9. Amazon Bedrock (`BedrockChatbotBedrockPermissions`)

**Resources Used (not created by CDK):**
- Bedrock foundation models (Claude, Titan, Llama, etc.)
- Knowledge Bases (optional)

**Permissions:**
- Invoke models (streaming and non-streaming)
- Converse API (model-agnostic inference)
- Knowledge Base retrieval
- List and describe models/knowledge bases
- Required for: Core chatbot functionality

### 10. CloudWatch Logs (`BedrockChatbotCloudWatchLogsPermissions`)

**Resources Created:**
- Log groups for all Lambda functions

**Permissions:**
- Create log groups and streams
- Put and read log events
- Filter logs
- Required for: Debugging, monitoring, troubleshooting

### 11. CloudFormation (`BedrockChatbotCloudFormationPermissions`)

**Resources Created:**
- All four CDK stacks

**Permissions:**
- Describe stacks, events, and resources
- Get templates
- Required for: Understanding deployed resources, debugging deployments

### 12. IAM Roles (`BedrockChatbotIAMReadPermissions`)

**Resources Created:**
- Execution roles for all Lambda functions

**Permissions:**
- Read-only access to roles and policies
- Required for: Understanding permissions, debugging IAM issues

### 13. KMS Keys (`BedrockChatbotKMSPermissions`)

**Resources Used:**
- AWS-managed KMS keys for SQS, DynamoDB, S3 encryption

**Permissions:**
- Encrypt, decrypt, generate data keys
- **Condition:** Only via SQS, DynamoDB, or S3 services
- Required for: Accessing encrypted data

## How to Use

### Option 1: Attach to Existing Policy

If you already have a policy (like the one in your question), add the statements from `iam-policy.json` to it:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    // ... your existing statements ...
    // ... add statements from iam-policy.json ...
  ]
}
```

### Option 2: Create Separate Policy

Create a new managed policy specifically for Bedrock Chatbot:

1. Go to IAM Console → Policies → Create Policy
2. Use the JSON editor and paste contents of `iam-policy.json`
3. Name it `BedrockChatbotAccess`
4. Attach to your IAM user or role

### Option 3: Inline Policy

Add as an inline policy to your IAM user or role:

```bash
aws iam put-user-policy \
  --user-name YOUR_USERNAME \
  --policy-name BedrockChatbotAccess \
  --policy-document file://docs/iam-policy.json
```

## CLI Tool Requirements

The `bedrock-chatbot config` CLI specifically requires:

- **SSM Parameter permissions** - To read/write `/bedrock-chatbot/config`
- **CloudFormation read permissions** - To verify stack deployment

Minimum policy for CLI:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ssm:GetParameter",
        "ssm:PutParameter",
        "ssm:GetParameterHistory"
      ],
      "Resource": "arn:aws:ssm:*:*:parameter/bedrock-chatbot/*"
    }
  ]
}
```

## Security Best Practices

1. **Principle of Least Privilege**: Start with read-only permissions and add write permissions as needed
2. **Resource Tagging**: Use CloudFormation tags to scope Cognito permissions
3. **KMS Conditions**: KMS permissions are scoped to specific AWS services
4. **Regional Scope**: Consider adding region conditions if you only deploy to specific regions
5. **Account Scope**: Replace `*` in account IDs with your specific AWS account ID where possible

## Testing Permissions

To verify your permissions are working:

```bash
# Test SSM parameter access
npm run cli config get

# Test Lambda function listing
aws lambda list-functions --query 'Functions[?contains(FunctionName, `BedrockChatbot`)]'

# Test DynamoDB table access
aws dynamodb describe-table --table-name BedrockChatbotSessions

# Test SQS queue access
aws sqs list-queues --queue-name-prefix BedrockChatbot
```

## Troubleshooting

### Access Denied Errors

If you get `AccessDenied` errors:

1. Check CloudWatch Logs for the specific permission denied
2. Verify the resource ARN matches your naming convention
3. Ensure IAM policy changes have propagated (can take up to 5 minutes)
4. Check for service control policies (SCPs) that might override permissions

### CLI Config Tool Fails

If `npm run cli config` fails:

1. Verify SSM parameter exists: `aws ssm get-parameter --name /bedrock-chatbot/config`
2. Check your AWS credentials: `aws sts get-caller-identity`
3. Verify region: `echo $AWS_REGION` or `echo $AWS_DEFAULT_REGION`

## Related Documentation

- [Configuration Guide](./configuration.md) - Using the CLI config tool
- [Deployment Guide](./deployment.md) - Deploying the CDK stacks
- [Architecture](./architecture.md) - System architecture overview
