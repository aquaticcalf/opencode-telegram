import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { vi } from "vitest"
import type { Bot } from "grammy"
import { createBot, stubCtx } from "../helpers.js"

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function handler(bot: Bot) {
  return (bot.on as any).mock.calls[0][1]
}

describe("slash commands", () => {
  it("/start sends welcome message", async () => {
    const { bot } = createBot()
    const ctx = stubCtx({ command: "/start" })
    await handler(bot)(ctx)
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("Hello!"), expect.any(Object))
  })

  it("/help describes bot capabilities", async () => {
    const { bot } = createBot()
    const ctx = stubCtx({ command: "/help" })
    await handler(bot)(ctx)
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("opencode-telegram-bot"),
      expect.any(Object),
    )
  })

  it("/new creates fresh session", async () => {
    const { bot } = createBot()
    const ctx = stubCtx({ command: "/new" })
    await handler(bot)(ctx)
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("fresh session"),
      expect.any(Object),
    )
  })

  it("/undo returns error when no session exists", async () => {
    const { bot } = createBot()
    const ctx = stubCtx({ command: "/undo" })
    await handler(bot)(ctx)
    expect(ctx.reply).toHaveBeenCalledWith("No active session to undo.", expect.any(Object))
  })

  it("/undo reverts last user message", async () => {
    const { tbot, client, bot } = createBot()
    ;(tbot as any).sessionMap["12345"] = "sess-1"
    client.session.messages.mockResolvedValue({
      data: [{ id: "msg-1", role: "user", parts: [{ type: "text", text: "hi" }] }],
    })
    client.session.revert.mockResolvedValue({})
    const ctx = stubCtx({ command: "/undo" })
    await handler(bot)(ctx)
    expect(client.session.revert).toHaveBeenCalledWith({
      path: { id: "sess-1" },
      body: { messageID: "msg-1" },
    })
    expect(ctx.reply).toHaveBeenCalledWith("Last message undone.", expect.any(Object))
  })

  it("/retry returns error when no session exists", async () => {
    const { bot } = createBot()
    const ctx = stubCtx({ command: "/retry" })
    await handler(bot)(ctx)
    expect(ctx.reply).toHaveBeenCalledWith("No active session to retry.", expect.any(Object))
  })
})
