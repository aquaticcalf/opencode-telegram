import { join } from "path"
import { tmpdir } from "os"
import { vi } from "vitest"
import type { Bot, Context } from "grammy"
import { TelegramBot } from "../plugin/bot.js"

let counter = 0

export function uniqueSessionPath() {
  return join(tmpdir(), `opencode-telegram-test-${process.pid}-${counter++}.json`)
}

export function stubCtx(overrides: Record<string, any> = {}): Context {
  const text = overrides.text ?? "hello"
  const msg: any = {
    message_id: overrides.messageId ?? 42,
    text: overrides.command ?? text,
    caption: overrides.caption,
    message_thread_id: overrides.threadId,
    reply_to_message: overrides.replyTo,
    photo: overrides.photo,
    document: overrides.document,
    voice: overrides.voice,
    audio: overrides.audio,
    video: overrides.video,
    from: { id: overrides.fromId ?? 111, username: `user_${overrides.fromId ?? 111}` },
    left_chat_member: overrides.leftChatMember,
    new_chat_members: overrides.newChatMembers,
  }
  return {
    msg,
    chat: { id: overrides.chatId ?? 12345, type: overrides.chatType ?? "private" },
    from: {
      id: overrides.fromId ?? 111,
      username: `user_${overrides.fromId ?? 111}`,
      first_name: "Test",
    },
    callbackQuery: overrides.callbackQuery,
    reply: overrides.reply ?? vi.fn().mockResolvedValue({ message_id: 999 }),
    replyWithChatAction: overrides.replyWithChatAction ?? vi.fn().mockResolvedValue(undefined),
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    editMessageText: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
  } as unknown as Context
}

export function makeClient() {
  const session = {
    create: vi.fn(),
    prompt: vi.fn(),
    messages: vi.fn(),
    revert: vi.fn(),
    message: vi.fn(),
  }
  return { session }
}

export function makeBotApi() {
  return {
    getMe: vi.fn().mockResolvedValue({ username: "test_bot", id: 999 }),
    sendMessage: vi.fn().mockResolvedValue({ message_id: 100 }),
    getFile: vi.fn(),
    editMessageText: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
  }
}

export function makeBot(botApi = makeBotApi()): Bot {
  return {
    on: vi.fn(),
    callbackQuery: vi.fn(),
    start: vi.fn(),
    stop: vi.fn().mockResolvedValue(undefined),
    api: botApi,
    token: "fake:token",
  } as unknown as Bot
}

export function createBot(config?: any) {
  const cfg = { allowedUsers: undefined, groupChats: undefined, ...config }
  const client = makeClient()
  const botApi = makeBotApi()
  const bot = makeBot(botApi)
  const tbot = new TelegramBot(cfg, client, bot, uniqueSessionPath())
  return { tbot, client, bot, botApi }
}
