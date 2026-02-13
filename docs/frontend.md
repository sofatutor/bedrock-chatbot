---
title: Frontend Walkthrough
layout: default
---

# Frontend Walkthrough

The POC ships a lightweight, no-build **index.html** that connects to the WebSocket and posts to the REST endpoint.

## Protocol

- **Send**: `POST /chat` with `{ prompt, sessionId, connectionId, messages, userId }`.
- **List threads**: `GET /threads?userId=...` (or header `x-user-id`).
- **Load thread**: `GET /threads?sessionId=...&userId=...`.
- **Receive**: WebSocket frames

```json
{ "event": "delta", "seq": 3, "content": "partial tokens..." }
{ "event": "complete" }
```

## Auth (recommended)

- Use Cognito Hosted UI or Amplify Auth to obtain a JWT and pass it to the REST call and `@connect` route.
- Store `connectionId↔userId` in DynamoDB with TTL for reconnection handling.
