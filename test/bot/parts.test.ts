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

describe("message part building", () => {
  it("sends plain text to opencode", async () => {
    const { client, bot, botApi } = createBot()
    botApi.getFile.mockResolvedValue({ file_path: "ignored" })
    client.session.create.mockResolvedValue({ data: { id: "sess-1" } })
    client.session.prompt.mockResolvedValue({
      data: { parts: [{ type: "text", text: "response" }] },
    })

    const ctx = stubCtx({ text: "Hello bot" })
    await handler(bot)(ctx)

    const parts = client.session.prompt.mock.calls[0][0].body.parts
    expect(parts).toContainEqual({ type: "text", text: "Hello bot" })
  })

  it("converts photo attachment to file part", async () => {
    const { client, bot, botApi } = createBot()
    botApi.getFile.mockResolvedValue({ file_path: "photos/abc.jpg" })
    client.session.create.mockResolvedValue({ data: { id: "sess-2" } })
    client.session.prompt.mockResolvedValue({
      data: { parts: [{ type: "text", text: "nice" }] },
    })

    const ctx = stubCtx({
      caption: "check this",
      photo: [
        { file_id: "thumb", width: 100, height: 100 },
        { file_id: "full", width: 800, height: 600 },
      ],
    })
    await handler(bot)(ctx)

    const parts = client.session.prompt.mock.calls[0][0].body.parts
    expect(parts).toContainEqual(expect.objectContaining({ type: "file", mime: "image/jpeg" }))
  })

  it("converts document to file part", async () => {
    const { client, bot, botApi } = createBot()
    botApi.getFile.mockResolvedValue({ file_path: "docs/report.pdf" })
    client.session.create.mockResolvedValue({ data: { id: "sess-3" } })
    client.session.prompt.mockResolvedValue({
      data: { parts: [{ type: "text", text: "got doc" }] },
    })

    const ctx = stubCtx({
      text: "here is a file",
      document: { file_id: "doc1", file_name: "report.pdf", mime_type: "application/pdf" },
    })
    await handler(bot)(ctx)

    const parts = client.session.prompt.mock.calls[0][0].body.parts
    expect(parts).toContainEqual(
      expect.objectContaining({ type: "file", mime: "application/pdf", filename: "report.pdf" }),
    )
  })

  it("converts voice message to ogg file part", async () => {
    const { client, bot, botApi } = createBot()
    botApi.getFile.mockResolvedValue({ file_path: "voice/msg.ogg" })
    client.session.create.mockResolvedValue({ data: { id: "sess-4" } })
    client.session.prompt.mockResolvedValue({
      data: { parts: [{ type: "text", text: "heard" }] },
    })

    const ctx = stubCtx({ voice: { file_id: "voice1", duration: 5 } })
    await handler(bot)(ctx)

    const parts = client.session.prompt.mock.calls[0][0].body.parts
    expect(parts).toContainEqual(
      expect.objectContaining({ type: "file", mime: "audio/ogg", filename: "voice.ogg" }),
    )
  })

  it("converts audio to mpeg file part", async () => {
    const { client, bot, botApi } = createBot()
    botApi.getFile.mockResolvedValue({ file_path: "audio/track.mp3" })
    client.session.create.mockResolvedValue({ data: { id: "sess-5" } })
    client.session.prompt.mockResolvedValue({
      data: { parts: [{ type: "text", text: "nice track" }] },
    })

    const ctx = stubCtx({
      audio: { file_id: "audio1", file_name: "track.mp3", mime_type: "audio/mpeg", duration: 180 },
    })
    await handler(bot)(ctx)

    const parts = client.session.prompt.mock.calls[0][0].body.parts
    expect(parts).toContainEqual(
      expect.objectContaining({ type: "file", mime: "audio/mpeg", filename: "track.mp3" }),
    )
  })
})
