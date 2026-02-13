const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs')
const {
  DynamoDBClient,
  PutItemCommand,
  UpdateItemCommand,
} = require('@aws-sdk/client-dynamodb')
const sqs = new SQSClient({})
const ddb = new DynamoDBClient({})

function getHeader(event, name) {
  const headers = event.headers || {}
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase())
  return key ? headers[key] : undefined
}

exports.handler = async (event) => {
  const body = JSON.parse(event.body || '{}')
  const { prompt, sessionId } = body
  // Accept legacy alias wsConnectionId as well
  let connectionId = body.connectionId || body.wsConnectionId || ''
  if (typeof connectionId !== 'string') connectionId = ''
  connectionId = connectionId.trim()

  if (!prompt || !connectionId) {
    return {
      statusCode: 400,
      body: JSON.stringify({ ok: false, error: 'connectionId and prompt are required' }),
    }
  }

  const headerUserId = getHeader(event, 'x-user-id')
  const userId =
    event.requestContext?.authorizer?.jwt?.claims?.email ||
    (typeof body.userId === 'string' ? body.userId.trim() : '') ||
    (typeof headerUserId === 'string' ? headerUserId.trim() : '') ||
    'anonymous'

  const msg = {
    userId,
    sessionId,
    prompt,
    connectionId,
    messages: Array.isArray(body.messages) ? body.messages : undefined,
    ts: Date.now(),
  }

  await sqs.send(
    new SendMessageCommand({
      QueueUrl: process.env.QUEUE_URL,
      MessageBody: JSON.stringify(msg),
    }),
  )

  const now = Date.now()
  const ttl = Math.floor(now / 1000) + 30 * 24 * 3600

  // store thread metadata and user message
  try {
    const title = String(prompt).slice(0, 80)
    await ddb.send(
      new PutItemCommand({
        TableName: process.env.SESSION_TABLE,
        Item: {
          pk: { S: `USER#${userId}` },
          sk: { S: `THREAD#${sessionId}` },
          type: { S: 'thread' },
          sessionId: { S: sessionId || 'unknown' },
          title: { S: title },
          createdAt: { N: String(now) },
          updatedAt: { N: String(now) },
          ttl: { N: String(ttl) },
        },
        ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)',
      }),
    )
  } catch (e) {
    if (e?.name !== 'ConditionalCheckFailedException') {
      console.log('Thread create failed', e)
    }
  }

  try {
    await ddb.send(
      new UpdateItemCommand({
        TableName: process.env.SESSION_TABLE,
        Key: { pk: { S: `USER#${userId}` }, sk: { S: `THREAD#${sessionId}` } },
        UpdateExpression: 'SET updatedAt = :u',
        ExpressionAttributeValues: { ':u': { N: String(now) } },
      }),
    )
  } catch (e) {
    console.log('Thread update failed', e)
  }

  try {
    await ddb.send(
      new PutItemCommand({
        TableName: process.env.SESSION_TABLE,
        Item: {
          pk: { S: `SESSION#${sessionId}` },
          sk: { S: `MSG#${now}#user` },
          type: { S: 'message' },
          role: { S: 'user' },
          content: { S: String(prompt) },
          userId: { S: userId },
          ts: { N: String(now) },
          ttl: { N: String(ttl) },
        },
      }),
    )
  } catch (e) {
    console.log('Message store failed', e)
  }

  // store simple session heartbeat (optional)
  try {
    await ddb.send(
      new PutItemCommand({
        TableName: process.env.SESSION_TABLE,
        Item: {
          pk: { S: `USER#${userId}` },
          sk: { S: `SESSION#${sessionId}#${Date.now()}` },
          ttl: { N: `${Math.floor(Date.now() / 1000) + 86400}` },
        },
      }),
    )
  } catch (e) {
    console.log('DDB put failed', e)
  }

  return { statusCode: 202, body: JSON.stringify({ ok: true }) }
}
