import type { Plugin, PluginModule } from "@opencode-ai/plugin"
import { createBot } from "./api.js"
import { TelegramBot } from "./bot.js"
import { acquireTokenLock, releaseTokenLock } from "./utils.js"

export type { BotConfig } from "./types.js"

const LOCK_DIR = ".opencode/telegram-locks"
const SESSION_MAP_PATH = ".opencode/telegram-sessions.json"

const server: Plugin = async (input, _options) => {
  const token: string | undefined = process.env.TELEGRAM_BOT_TOKEN
  if (!token) {
    console.warn("[opencode-telegram] TELEGRAM_BOT_TOKEN not set, plugin disabled")
    return {}
  }

  const baseDir = [input.worktree, input.directory, process.env.HOME, "/tmp"].find(
    (p) => p && p !== "/",
  )!
  const lockDir = `${baseDir}/${LOCK_DIR}`

  if (!acquireTokenLock(token, lockDir)) {
    console.error("[opencode-telegram] Another process is already using this bot token. Refusing to start.")
    return {
      dispose: async () => {},
    }
  }

  console.log("[opencode-telegram] Loading plugin...")
  const t0 = Date.now()

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
  console.log(`[opencode-telegram] Bot created (${Date.now() - t0}ms)`)

  const sessionMapPath = `${baseDir}/${SESSION_MAP_PATH}`

  const telegram = new TelegramBot(config, input.client as any, bot, sessionMapPath)
  console.log(`[opencode-telegram] TelegramBot created, starting... (${Date.now() - t0}ms)`)
  telegram.start()
  console.log(`[opencode-telegram] Plugin init done (${Date.now() - t0}ms)`)

  return {
    dispose: async () => {
      await telegram.stop()
      releaseTokenLock(token, lockDir)
    },

    "permission.ask": async (input, output) => {
      const action = await telegram.requestApproval(input)
      output.status = action
    },
  }
}

export default { id: "@aquaticcalf/opencode-telegram", server } satisfies PluginModule
