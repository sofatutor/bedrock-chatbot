const { DynamoDBClient, QueryCommand } = require('@aws-sdk/client-dynamodb')
const ddb = new DynamoDBClient({})

function getHeader(event, name) {
  const headers = event.headers || {}
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase())
  return key ? headers[key] : undefined
}

exports.handler = async (event) => {
  const qs = event.queryStringParameters || {}
  const headerUserId = getHeader(event, 'x-user-id')
  const userId = qs.userId || headerUserId || 'anonymous'
  const sessionId = qs.sessionId

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  }

  // If sessionId is provided, return messages for that session
  if (sessionId) {
    try {
      const result = await ddb.send(
        new QueryCommand({
          TableName: process.env.SESSION_TABLE,
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
          ExpressionAttributeValues: {
            ':pk': { S: `SESSION#${sessionId}` },
            ':prefix': { S: 'MSG#' },
          },
          ScanIndexForward: true,
        }),
      )
      const messages = (result.Items || []).map((item) => ({
        role: item.role?.S || 'user',
        content: item.content?.S || '',
        ts: Number(item.ts?.N || 0),
      }))
      return { statusCode: 200, headers, body: JSON.stringify({ messages }) }
    } catch (e) {
      console.log('Query messages failed', e)
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to load messages' }) }
    }
  }

  // Otherwise, return threads for the user
  try {
    const result = await ddb.send(
      new QueryCommand({
        TableName: process.env.SESSION_TABLE,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
        ExpressionAttributeValues: {
          ':pk': { S: `USER#${userId}` },
          ':prefix': { S: 'THREAD#' },
        },
        ScanIndexForward: false,
      }),
    )
    const threads = (result.Items || []).map((item) => ({
      sessionId: item.sessionId?.S || '',
      title: item.title?.S || '',
      createdAt: Number(item.createdAt?.N || 0),
      updatedAt: Number(item.updatedAt?.N || 0),
    }))
    return { statusCode: 200, headers, body: JSON.stringify({ threads }) }
  } catch (e) {
    console.log('Query threads failed', e)
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to load threads' }) }
  }
}
