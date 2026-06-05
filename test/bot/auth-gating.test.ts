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

describe("authorization", () => {
  it("blocks unauthorized user in private chat", async () => {
    const { bot } = createBot({ allowedUsers: new Set([999]) })
    const ctx = stubCtx({ text: "hello", fromId: 111 })
    await handler(bot)(ctx)
    expect(ctx.reply).toHaveBeenCalledWith("You are not authorized to use this bot.")
  })

  it("silently ignores unauthorized user in group", async () => {
    const { bot } = createBot({ allowedUsers: new Set([999]) })
    const ctx = stubCtx({ text: "hello", fromId: 111, chatType: "supergroup" })
    await handler(bot)(ctx)
    expect(ctx.reply).not.toHaveBeenCalled()
  })

  it("allows authorized user to proceed", async () => {
    const { client, bot } = createBot({ allowedUsers: new Set([111]) })
    client.session.create.mockResolvedValue({ data: { id: "sess-auth" } })
    client.session.prompt.mockResolvedValue({
      data: { parts: [{ type: "text", text: "ok" }] },
    })
    const ctx = stubCtx({ text: "hello", fromId: 111 })
    await handler(bot)(ctx)
    expect(ctx.replyWithChatAction).toHaveBeenCalled()
  })
})

describe("group gating", () => {
  it("drops unmentioned message when groupChats=deny", async () => {
    const { bot } = createBot({ groupChats: "deny" })
    const ctx = stubCtx({ text: "hello everyone", chatType: "group", chatId: -100 })
    await handler(bot)(ctx)
    expect(ctx.reply).not.toHaveBeenCalled()
  })

  it("allows mentioned message when groupChats=deny", async () => {
    const { client, bot } = createBot({ groupChats: "deny" })
    client.session.create.mockResolvedValue({ data: { id: "sess-group" } })
    client.session.prompt.mockResolvedValue({
      data: { parts: [{ type: "text", text: "ok" }] },
    })
    const ctx = stubCtx({ text: "hello @test_bot", chatType: "group", chatId: -100 })
    await handler(bot)(ctx)
    expect(ctx.replyWithChatAction).toHaveBeenCalled()
  })

  it("processes group message when gating is unset", async () => {
    const { client, bot } = createBot()
    client.session.create.mockResolvedValue({ data: { id: "sess-group" } })
    client.session.prompt.mockResolvedValue({
      data: { parts: [{ type: "text", text: "ok" }] },
    })
    const ctx = stubCtx({ text: "hello group", chatType: "supergroup", chatId: -100 })
    await handler(bot)(ctx)
    expect(ctx.replyWithChatAction).toHaveBeenCalled()
  })
})
