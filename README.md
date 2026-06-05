# @aquaticcalf/opencode-telegram

Telegram bot plugin for [opencode](https://opencode.ai). Forwards messages between Telegram and opencode, with inline approval buttons for tool execution.

## Features

- **Two-way messaging** — send a message on Telegram, get the AI response back
- **Media support** — photos, documents, voice/audio messages, and video
- **Tool approval** — Approve/Deny inline buttons when opencode needs permission
- **Group chat** — mention-gating (`@bot` required), configurable via env
- **Session isolation** — each Telegram chat maps to a dedicated opencode session
- **Slash commands** — `/start`, `/help`, `/new`, `/undo`, `/retry`
- **MarkdownV2** — formatted responses with automatic plain-text fallback
- **Typing indicator** — shows "typing..." while the AI is thinking
- **Long message splitting** — messages over 4096 chars are split automatically

## Installation

```bash
npm install @aquaticcalf/opencode-telegram
```

## Usage

Add to your `opencode.json`:

```json
{
  "plugin": ["@aquaticcalf/opencode-telegram"]
}
```

Or install as a local plugin file (no npm needed):

```json
{
  "plugin": ["./path/to/opencode-telegram/dist/index.js"]
}
```

### Environment Variables

| Variable                 | Required | Description                                              |
| ------------------------ | -------- | -------------------------------------------------------- |
| `TELEGRAM_BOT_TOKEN`     | Yes      | Bot token from [@BotFather](https://t.me/BotFather)      |
| `TELEGRAM_ALLOWED_USERS` | No       | Comma-separated Telegram user IDs (leaves open if unset) |
| `TELEGRAM_GROUP_CHATS`   | No       | Set to `allow` to respond in groups without `@mention`   |

### Getting a Bot Token

1. Open Telegram and search for [@BotFather](https://t.me/BotFather)
2. Send `/newbot` and follow the prompts
3. Copy the API token and set it as `TELEGRAM_BOT_TOKEN`

## Slash Commands

| Command  | Description                      |
| -------- | -------------------------------- |
| `/start` | Welcome message and command list |
| `/help`  | Show this help text              |
| `/new`   | Start a fresh opencode session   |
| `/undo`  | Undo the last AI response        |
| `/retry` | Retry the last message           |

## How It Works

```
Telegram user → Bot message → opencode session.prompt() → AI response → Telegram
```

1. **You send a message** to the bot on Telegram
2. The plugin receives it via grammy long-polling
3. A new (or existing) opencode session receives the message via the REST API
4. The AI processes and responds
5. The response is sent back to Telegram with MarkdownV2 formatting
6. If a tool requires approval, inline Approve/Deny buttons appear

## Development

```bash
git clone https://github.com/aquaticcalf/opencode-telegram.git
cd opencode-telegram
npm install
npm run build
```

## License

MIT
