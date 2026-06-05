import { Bot } from "grammy"
import type { BotConfig } from "./types.js"

export function createBot(config: BotConfig): Bot {
  return new Bot(config.token)
}
