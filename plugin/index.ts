import type { Plugin } from "@opencode-ai/plugin"
import { createBot } from "./api.js"
import { TelegramBot } from "./bot.js"

export type { BotConfig } from "./types.js"
export { TelegramBot } from "./bot.js"

const SESSION_MAP_PATH = ".opencode/telegram-sessions.json"

export default (async (input, _options) => {
  const token: string | undefined = process.env.TELEGRAM_BOT_TOKEN
  if (!token) {
    console.warn("[opencode-telegram] TELEGRAM_BOT_TOKEN not set, plugin disabled")
    return {}
  }

  const allowedUsersRaw: string | undefined = process.env.TELEGRAM_ALLOWED_USERS
  const allowedUsers = allowedUsersRaw
    ? new Set(
        allowedUsersRaw
          .split(",")
          .map((s: string) => parseInt(s.trim(), 10))
          .filter((n: number) => !isNaN(n)),
      )
    : undefined

  const groupChats: "allow" | "deny" =
    process.env.TELEGRAM_GROUP_CHATS === "allow" ? "allow" : "deny"

  const config = { token, allowedUsers, groupChats }
  const bot = createBot(config)
  const sessionMapPath = input.worktree
    ? `${input.worktree}/${SESSION_MAP_PATH}`
    : `${input.directory}/${SESSION_MAP_PATH}`

  const telegram = new TelegramBot(config, input.client as any, bot, sessionMapPath)
  telegram.start()

  return {
    dispose: async () => {
      await telegram.stop()
    },

    "permission.ask": async (input, output) => {
      const action = await telegram.requestApproval(input)
      output.status = action
    },
  }
}) satisfies Plugin
