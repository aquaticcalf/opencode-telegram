# PLANS: opencode-telegram → Chat SDK + Opencode Client

## Goal

Convert opencode-telegram from a **grammy-based opencode plugin** to a **standalone opencode client** that:

- Uses `@chat-adapter/telegram` + `chat` (from `chat/packages`) instead of `grammy`
- Uses `@opencode-ai/sdk` instead of the plugin client injection
- Follows hermes-agent's gateway pattern: standalone daemon, not a plugin
- Uses long-polling for local dev, webhook-ready for production

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                 opencode-telegram                        │
│                                                         │
│  ┌──────────────┐    ┌──────────────┐    ┌───────────┐  │
│  │ @chat-adapter │    │  @opencode-  │    │           │  │
│  │  /telegram   │───▶│   ai/sdk     │───▶│ opencode  │  │
│  │ (polling)    │    │ (REST client)│    │  server   │  │
│  └──────┬───────┘    └──────┬───────┘    └───────────┘  │
│         │                   │                            │
│         ▼                   ▼                            │
│  ┌─────────────────────────────────┐                    │
│  │         Bridge Layer            │                    │
│  │  - Message forwarding           │                    │
│  │  - Session mapping              │                    │
│  │  - Permission approval          │                    │
│  │  - Slash commands               │                    │
│  │  - Typing indicators            │                    │
│  │  - Streaming responses          │                    │
│  └─────────────────────────────────┘                    │
└─────────────────────────────────────────────────────────┘
```

## File Structure

```
opencode-telegram/
├── src/
│   ├── index.ts          # Main entry — daemon lifecycle
│   ├── bot.ts            # TelegramAdapter wrapper (polling)
│   ├── client.ts         # OpencodeClient wrapper
│   ├── handler.ts        # Message handler bridge
│   ├── session.ts        # Session store (chat↔opencode)
│   ├── approval.ts       # Inline keyboard permissions
│   ├── commands.ts       # Slash commands
│   ├── format.ts         # Markdown formatting helpers
│   └── types.ts          # Shared types
├── package.json
├── tsconfig.json
└── README.md
```

## Message Flow

```
Telegram user sends message
        │
        ▼
TelegramAdapter polls getUpdates
        │
        ▼
processUpdate() → handleIncomingMessageUpdate()
        │
        ▼
Handler receives Message (normalized Chat SDK format)
        │
        ├── Slash command? → handleCommand()
        ├── Button callback? → handleApproval()
        └── Regular message → forwardToOpencode()
                │
                ▼
Session lookup (chatId:threadId → sessionID)
                │
                ▼
opencodeClient.v2.session.prompt({ sessionID, body: { parts } })
                │
                ▼
Wait for completion via polling or SSE
                │
                ▼
Send response back via TelegramAdapter.postMessage()
```

## Session Mapping

- Key: `telegram:{chatId}` or `telegram:{chatId}:{threadId}` (forum topics)
- Value: opencode session ID (`ses_xxx`)
- Persisted in JSON file (same as current approach)

## Permission Approval Flow

```
opencode sends permission request via REST API
        │
        ▼
Poll permission requests or listen for events
        │
        ▼
Send inline keyboard to Telegram: [Approve] [Deny]
        │
        ▼
User clicks button → callback_query received
        │
        ▼
POST /api/session/:id/permission/request/:reqId/reply
```

## Key Changes from Current Code

| Area | Before | After |
|------|--------|-------|
| Telegram lib | `grammy` + `@grammyjs/runner` | `@chat-adapter/telegram` |
| Opencode access | Plugin `input.client` injection | `@opencode-ai/sdk` REST client |
| Architecture | Plugin loaded by opencode | Standalone daemon |
| Entry point | Exported `PluginModule` | `src/index.ts` with `main()` |
| Message format | Raw grammy `Context` | Normalized Chat SDK `Message` |
| Formatting | Hand-rolled `escapeMd()` | `TelegramFormatConverter` via adapter |
| File uploads | Manual `getFile` → raw URL | Adapter handles attachments |
| Typing indicator | Manual `setInterval` polling | `adapter.startTyping()` |
| Dedup | Manual `processedUpdates` Set | Adapter handles dedup |
| Deployment | `opencode.json` plugin entry | `node dist/index.js` daemon |

## Implementation Order

1. Build chat packages (chat, adapter-telegram, adapter-shared, state-memory)
2. Set up package.json with new dependencies
3. Implement types.ts
4. Implement session.ts
5. Implement client.ts (opencode SDK wrapper)
6. Implement bot.ts (Telegram adapter wrapper)
7. Implement format.ts (formatting helpers)
8. Implement approval.ts (permission handling)
9. Implement commands.ts (slash commands)
10. Implement handler.ts (message bridge)
11. Implement index.ts (main entry)
12. Update tsconfig.json
13. Build and verify
