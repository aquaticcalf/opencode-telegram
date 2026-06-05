import { describe, it, expect } from "vitest"
import { deferred, escapeMarkdown, splitLongMessage, chatKey } from "../plugin/utils.js"

describe("deferred", () => {
  it("creates a promise that resolves manually", async () => {
    const d = deferred<number>()
    d.resolve(42)
    expect(await d.promise).toBe(42)
  })

  it("creates a promise that rejects on throw", async () => {
    const d = deferred<number>()
    d.reject(new Error("fail"))
    await expect(d.promise).rejects.toThrow("fail")
  })
})

describe("escapeMarkdown", () => {
  it("escapes special characters", () => {
    expect(escapeMarkdown("_*[]()~`>#+-=|{}.")).toBe(
      "\\_\\*\\[\\]\\(\\)\\~\\`\\>\\#\\+\\-\\=\\|\\{\\}\\.",
    )
  })

  it("leaves normal text unchanged", () => {
    expect(escapeMarkdown("hello world 123")).toBe("hello world 123")
  })

  it("escapes mixed content", () => {
    expect(escapeMarkdown("foo_bar [link]")).toBe("foo\\_bar \\[link\\]")
  })
})

describe("splitLongMessage", () => {
  it("returns single chunk for short text", () => {
    expect(splitLongMessage("short")).toEqual(["short"])
  })

  it("splits at newline boundary when possible", () => {
    const long = "a".repeat(3000) + "\n" + "b".repeat(2000)
    const chunks = splitLongMessage(long, 3500)
    expect(chunks.length).toBeGreaterThanOrEqual(2)
    expect(chunks[0].length).toBeLessThanOrEqual(3500)
    expect(chunks.join("")).toBe(long)
  })

  it("splits at space boundary when no newline", () => {
    const long = "word ".repeat(1000).trim()
    const chunks = splitLongMessage(long, 4096)
    expect(chunks.every((c) => c.length <= 4096)).toBe(true)
    expect(chunks.join("")).toBe(long)
  })

  it("handles text within limit without splitting", () => {
    const text = "Hello, this is a test message!"
    expect(splitLongMessage(text)).toEqual([text])
  })
})

describe("chatKey", () => {
  it("uses chatId only when no threadId", () => {
    expect(chatKey(12345)).toBe("12345")
  })

  it("includes threadId when provided", () => {
    expect(chatKey(12345, 678)).toBe("12345:678")
  })

  it("ignores zero threadId (not a valid Telegram value)", () => {
    expect(chatKey(12345, 0)).toBe("12345")
  })
})
