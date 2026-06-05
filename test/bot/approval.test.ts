import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { vi } from "vitest"
import { createBot } from "../helpers.js"
import type { TelegramPermission } from "../../plugin/types.js"

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function permission(overrides: Partial<TelegramPermission> = {}): TelegramPermission {
  return {
    id: "perm-1",
    type: "exec",
    sessionID: "sess-1",
    messageID: "msg-1",
    title: "Test",
    pattern: undefined,
    metadata: {},
    time: { created: Date.now() },
    ...overrides,
  }
}

describe("requestApproval", () => {
  it("sends permission message with Approve/Deny/Dismiss buttons", async () => {
    const { tbot, botApi } = createBot()
    ;(tbot as any).sessionMap["12345"] = "sess-1"

    const promise = tbot.requestApproval(permission({ title: "Execute", pattern: "rm -rf /" }))
    await vi.advanceTimersByTimeAsync(0)

    expect(promise).toBeInstanceOf(Promise)
    expect(botApi.sendMessage).toHaveBeenCalledWith(
      12345,
      expect.stringContaining("Permission Requested"),
      expect.objectContaining({
        parse_mode: "MarkdownV2",
        reply_markup: expect.objectContaining({
          inline_keyboard: expect.arrayContaining([
            expect.arrayContaining([expect.objectContaining({ text: "✅ Approve" })]),
          ]),
        }),
      }),
    )
  })

  it("resolves to allow when user approves", async () => {
    const { tbot } = createBot()
    ;(tbot as any).sessionMap["12345"] = "sess-1"

    const approvalPromise = tbot.requestApproval(permission())
    await vi.advanceTimersByTimeAsync(0)

    const pending = (tbot as any).pendingApprovals.get("perm-1")
    pending.resolve("allow")

    const result = await approvalPromise
    expect(result).toBe("allow")
  })

  it("resolves to deny when approval times out", async () => {
    const { tbot } = createBot()
    ;(tbot as any).sessionMap["12345"] = "sess-1"

    const approvalPromise = tbot.requestApproval(permission())
    await vi.advanceTimersByTimeAsync(300_000)

    const result = await approvalPromise
    expect(result).toBe("deny")
  })

  it("returns deny when chat is not tracked", async () => {
    const { tbot } = createBot()

    const result = await tbot.requestApproval(permission({ sessionID: "nonexistent" }))
    expect(result).toBe("deny")
  })
})

describe("callback query handling", () => {
  function cbCtx(data: string) {
    const ctx: any = {
      callbackQuery: { data },
      msg: { text: "Approve?" },
      answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
      editMessageText: vi.fn().mockResolvedValue(undefined),
      deleteMessage: vi.fn().mockResolvedValue(undefined),
    }
    return ctx
  }

  it("registers callback query handler during construction", () => {
    const { bot } = createBot()
    expect(bot.callbackQuery).toHaveBeenCalledWith(/^(allow|deny|dismiss):.+/, expect.any(Function))
  })

  it("answers 'Approved' on allow", async () => {
    const { tbot, bot } = createBot()
    ;(tbot as any).pendingApprovals.set("perm-1", { resolve: vi.fn() })

    const cbHandler = (bot.callbackQuery as any).mock.calls[0][1]
    const ctx = cbCtx("allow:perm-1")
    await cbHandler(ctx)

    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith("Approved")
  })

  it("answers 'Denied' on deny", async () => {
    const { tbot, bot } = createBot()
    ;(tbot as any).pendingApprovals.set("perm-2", { resolve: vi.fn() })

    const cbHandler = (bot.callbackQuery as any).mock.calls[0][1]
    const ctx = cbCtx("deny:perm-2")
    await cbHandler(ctx)

    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith("Denied")
  })

  it("answers 'Dismissed' on dismiss", async () => {
    const { bot } = createBot()

    const cbHandler = (bot.callbackQuery as any).mock.calls[0][1]
    const ctx = cbCtx("dismiss:perm-3")
    await cbHandler(ctx)

    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith("Dismissed")
  })
})
