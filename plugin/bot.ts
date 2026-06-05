import type { Bot, Context } from "grammy"
import { run } from "@grammyjs/runner"
import type { BotConfig, PendingApproval, TelegramPermission, SdkPart } from "./types.js"
import type { OpencodeClient } from "./client.js"
import { deferred, escapeMarkdown, chatKey, stripFormatting } from "./utils.js"
import { loadSessionMap, saveSessionMap } from "./session.js"
import { escapeMd, formatToolResult } from "./extract.js"

const APPROVAL_TIMEOUT_MS = 300_000
const TYPING_INTERVAL_MS = 5000
const MAX_CONFLICT_RETRIES = 5
const MAX_NETWORK_RETRIES = 10
const DEDUP_SET_MAX = 1000

export class TelegramBot {
  private config: BotConfig
  private client: OpencodeClient
  private bot: Bot
  private sessionMap: Record<string, string>
  private sessionMapPath: string
  private sessionChatMap = new Map<string, { chatId: number; threadId?: number }>()
  private pendingApprovals = new Map<string, PendingApproval>()
  private stopped = false
  private typingIntervals = new Map<string, ReturnType<typeof setInterval>>()
  private processedUpdates = new Set<number>()
  private startPromise: Promise<void> | null = null
  private runnerHandle: ReturnType<typeof run> | null = null

  constructor(config: BotConfig, client: OpencodeClient, bot: Bot, sessionMapPath: string) {
    this.config = config
    this.client = client
    this.bot = bot
    this.sessionMapPath = sessionMapPath
    this.sessionMap = loadSessionMap(sessionMapPath)
    this.setupHandlers()
  }

  private setupHandlers(): void {
    this.bot.on("message", async (ctx) => {
      if (this.stopped) return

      if (this.processedUpdates.has(ctx.update.update_id)) return
      this.processedUpdates.add(ctx.update.update_id)
      if (this.processedUpdates.size > DEDUP_SET_MAX) {
        const first = this.processedUpdates.values().next().value
        if (first !== undefined) this.processedUpdates.delete(first)
      }

      const msg = ctx.msg!
      if (msg.left_chat_member || msg.new_chat_members || msg.group_chat_created) return

      const chatId = ctx.chat!.id
      const chatType = ctx.chat!.type
      const isGroup = chatType === "group" || chatType === "supergroup"
      const threadId = msg.message_thread_id ?? undefined

      if (isGroup && this.config.groupChats === "deny") {
        const text = msg.text || msg.caption || ""
        if (!text.includes(`@${this.bot.botInfo.username}`)) return
      }

      if (this.config.allowedUsers && ctx.from && !this.config.allowedUsers.has(ctx.from.id)) {
        if (isGroup) return
        await ctx.reply("You are not authorized to use this bot.")
        return
      }

      if (msg.text?.startsWith("/")) {
        return this.handleCommand(ctx, chatId, threadId)
      }

      await this.handleUserMessage(ctx, chatId, threadId)
    })

    this.bot.callbackQuery(/^(allow|deny|dismiss):.+/, async (ctx) => {
      if (this.stopped) return
      const data = ctx.callbackQuery.data
      const [action, permissionId] = data.split(":")

      await ctx.answerCallbackQuery(
        action === "allow" ? "Approved" : action === "deny" ? "Denied" : "Dismissed",
      )

      if ((action === "allow" || action === "deny") && permissionId) {
        const pending = this.pendingApprovals.get(permissionId)
        if (pending) {
          pending.resolve(action === "allow" ? "allow" : "deny")
          this.pendingApprovals.delete(permissionId)
          try {
            const text = ctx.msg!.text || ""
            await ctx.editMessageText(
              text + `\n\n_${action === "allow" ? "Approved" : "Denied"}_`,
              { parse_mode: "MarkdownV2" },
            )
          } catch { }
        }
      } else if (action === "dismiss" && permissionId) {
        this.pendingApprovals.delete(permissionId)
        try {
          await ctx.deleteMessage()
        } catch { }
      }
    })
  }

  start(): void {
    this.stopped = false
    console.log("[opencode-telegram] Starting bot with concurrent runner (409 retry)...")
    this.startPromise = this._startWithRetry()
    this.startPromise.catch((err) => {
      console.error("[opencode-telegram] bot runner failed after all retries:", err)
    })
  }

  private async _startWithRetry(): Promise<void> {
    for (let attempt = 1; attempt <= MAX_CONFLICT_RETRIES; attempt++) {
      try {
        await this._startRunner()
        return
      } catch (err: any) {
        if (this.runnerHandle) {
          try { await this.runnerHandle.stop() } catch { }
          this.runnerHandle = null
        }

        if (err?.error_code === 409) {
          if (attempt < MAX_CONFLICT_RETRIES) {
            const delay = attempt * 10_000
            console.log(
              `[opencode-telegram] 409 conflict (${attempt}/${MAX_CONFLICT_RETRIES}) — ` +
              `previous session still held open. Waiting ${delay / 1000}s...`,
            )
            await new Promise((r) => setTimeout(r, delay))
            continue
          }
          console.error(
            `[opencode-telegram] 409 conflict exhausted all ${MAX_CONFLICT_RETRIES} retries. ` +
            `Another process is using the same bot token. Stop the other instance first.`,
          )
          throw err
        }

        if (this._isNetworkError(err)) {
          if (attempt < MAX_NETWORK_RETRIES) {
            const delay = Math.min(5 * 2 ** (attempt - 1), 60) * 1000
            console.log(
              `[opencode-telegram] Network error (${attempt}/${MAX_NETWORK_RETRIES}), retrying in ${delay / 1000}s: ${err.message}`,
            )
            await new Promise((r) => setTimeout(r, delay))
            continue
          }
          console.error(`[opencode-telegram] Network error exhausted all ${MAX_NETWORK_RETRIES} retries.`)
          throw err
        }

        throw err
      }
    }
  }

  private async _startRunner(): Promise<void> {
    this.runnerHandle = run(this.bot, {
      runner: {
        fetch: {
          allowed_updates: ["message", "callback_query"],
        },
      },
    })
    const info = await this.bot.api.getMe()
    console.log(`[opencode-telegram] Bot started as @${info.username}`)
    this.stopped = false
    await this.runnerHandle.task
  }

  private _isNetworkError(err: any): boolean {
    if (!err) return false
    const name = err.constructor?.name?.toLowerCase() || ""
    const msg = (err.message || "").toLowerCase()
    return (
      name.includes("networkerror") ||
      name.includes("timeout") ||
      name.includes("connectionerror") ||
      msg.includes("etimedout") ||
      msg.includes("econnrefused") ||
      msg.includes("econnreset") ||
      msg.includes("enotfound") ||
      msg.includes("socket hang up") ||
      msg.includes("fetch failed")
    )
  }

  async stop(): Promise<void> {
    this.stopped = true
    for (const interval of this.typingIntervals.values()) {
      clearInterval(interval)
    }
    this.typingIntervals.clear()
    if (this.runnerHandle) {
      try { await this.runnerHandle.stop() } catch { }
      this.runnerHandle = null
    }
    console.log("[opencode-telegram] Bot stopped")
  }

  private async handleCommand(ctx: Context, chatId: number, threadId?: number): Promise<void> {
    const msg = ctx.msg!
    const parts = msg.text!.split(/\s+/)
    const cmd = parts[0].toLowerCase().split("@")[0]

    switch (cmd) {
      case "/start":
        await ctx.reply(
          "Hello! I'm a Telegram bot for opencode.\n\n" +
            "Send me a message and I'll forward it to the AI for processing.\n\n" +
            "Commands:\n" +
            "/new - Start a fresh session\n" +
            "/undo - Undo last message\n" +
            "/retry - Retry last response\n" +
            "/help - Show this message",
          { message_thread_id: threadId },
        )
        break

      case "/help":
        await ctx.reply(
          "opencode-telegram-bot\n\n" +
            "Forwards messages to opencode via Telegram.\n" +
            "Supports text, images, documents, voice, stickers, locations, and more.\n\n" +
            "Commands:\n" +
            "/new - Start a fresh session\n" +
            "/undo - Undo the last AI response\n" +
            "/retry - Retry the last message\n" +
            "/help - Show this message",
          { message_thread_id: threadId },
        )
        break

      case "/new": {
        const key = chatKey(chatId, threadId)
        delete this.sessionMap[key]
        saveSessionMap(this.sessionMapPath, this.sessionMap)
        await ctx.reply("Started a fresh session. What would you like to do?", {
          message_thread_id: threadId,
        })
        break
      }

      case "/undo": {
        const key = chatKey(chatId, threadId)
        const sessionId = this.sessionMap[key]
        if (!sessionId) {
          await ctx.reply("No active session to undo.", { message_thread_id: threadId })
          break
        }
        try {
          const res = await this.client.session.messages({ path: { id: sessionId } })
          const userMessages = (res.data || []).filter((m: any) => m.role === "user")
          if (userMessages.length > 0) {
            const last = userMessages[userMessages.length - 1]
            await this.client.session.revert({
              path: { id: sessionId },
              body: { messageID: last.id },
            })
            await ctx.reply("Last message undone.", { message_thread_id: threadId })
          } else {
            await ctx.reply("No messages to undo.", { message_thread_id: threadId })
          }
        } catch {
          await ctx.reply("Failed to undo last message.", { message_thread_id: threadId })
        }
        break
      }

      case "/retry": {
        const key = chatKey(chatId, threadId)
        const sessionId = this.sessionMap[key]
        if (!sessionId) {
          await ctx.reply("No active session to retry.", { message_thread_id: threadId })
          break
        }
        try {
          const res = await this.client.session.messages({ path: { id: sessionId } })
          const userMessages = (res.data || []).filter((m: any) => m.role === "user")
          if (userMessages.length < 1) {
            await ctx.reply("No messages to retry.", { message_thread_id: threadId })
            break
          }
          const last = userMessages[userMessages.length - 1]
          const detail = await this.client.session.message({
            path: { id: sessionId, messageID: last.id },
          })
          const userParts = detail?.data?.parts || []

          if (userMessages.length > 1) {
            const prev = userMessages[userMessages.length - 2]
            await this.client.session.revert({
              path: { id: sessionId },
              body: { messageID: prev.id },
            })
          }
          await this.sendToChat(ctx, chatId, threadId, userParts, true)
        } catch {
          await ctx.reply("Failed to retry.", { message_thread_id: threadId })
        }
        break
      }

      default:
        await this.handleUserMessage(ctx, chatId, threadId)
    }
  }

  private async sendToChat(ctx: Context, chatId: number, threadId: number | undefined, userParts: any[], isRetry?: boolean): Promise<void> {
    const key = chatKey(chatId, threadId)
    let sessionId = this.sessionMap[key]

    if (!sessionId) {
      try {
        const session = await this.client.session.create({
          body: { title: `Telegram Chat ${chatId}` },
        })
        sessionId = (session.data?.id || session.id)!
        this.sessionMap[key] = sessionId
        this.sessionChatMap.set(sessionId, { chatId, threadId })
        saveSessionMap(this.sessionMapPath, this.sessionMap)
      } catch (err) {
        console.error("[opencode-telegram] Failed to create session:", err)
        await ctx.reply("Failed to start a session. Is the opencode server running?", {
          message_thread_id: threadId,
        })
        return
      }
    }

    const parts = isRetry ? userParts : await this.buildMessageParts(ctx)

    if (parts.length === 0) {
      await ctx.reply(
        "I received your message but couldn't process it. Telegram message types I support: text, images, documents, voice messages, audio, video, stickers, animations (GIFs), and locations.",
        { message_thread_id: threadId },
      )
      return
    }

    const placeholder = await ctx.reply("🤔 *Thinking…*", {
      parse_mode: "MarkdownV2",
      message_thread_id: threadId,
    })

    void ctx.replyWithChatAction("typing")
    const typingInterval = setInterval(() => {
      void ctx.replyWithChatAction("typing")
    }, TYPING_INTERVAL_MS)
    this.typingIntervals.set(key, typingInterval)

    try {
      const result = await this.client.session.prompt({
        path: { id: sessionId },
        body: { parts },
      })

      clearInterval(typingInterval)
      this.typingIntervals.delete(key)

      const responseParts: SdkPart[] = result?.data?.parts || []

      const textParts: SdkPart[] = []
      const toolParts: (SdkPart & { type: "tool" })[] = []
      const fileParts: (SdkPart & { type: "file" })[] = []

      for (const p of responseParts) {
        if (p.type === "text") textParts.push(p)
        else if (p.type === "tool") toolParts.push(p as SdkPart & { type: "tool" })
        else if (p.type === "file") fileParts.push(p as SdkPart & { type: "file" })
      }

      // Edit placeholder with text response
      let textContent = ""
      for (const tp of textParts) {
        if ("text" in tp && tp.text) textContent += tp.text + "\n"
      }
      textContent = textContent.trim()

      if (textContent) {
        try {
          await ctx.api.editMessageText(chatId, placeholder.message_id, escapeMd(textContent), {
            parse_mode: "MarkdownV2",
          })
        } catch {
          await ctx.api.editMessageText(chatId, placeholder.message_id, stripFormatting(textContent))
        }
      } else {
        await ctx.api.editMessageText(chatId, placeholder.message_id, "_Done_", { parse_mode: "MarkdownV2" })
      }

      // Send tool call messages
      for (const tp of toolParts) {
        if (tp.state.status === "completed" || tp.state.status === "error") {
          const text = formatToolResult(tp)
          try {
            await ctx.reply(text, { parse_mode: "MarkdownV2", message_thread_id: threadId })
          } catch {
            await ctx.reply(stripFormatting(text), { message_thread_id: threadId })
          }
          await new Promise((r) => setTimeout(r, 200))
        }
      }

      // Send file parts
      for (const fp of fileParts) {
        if (fp.mime?.startsWith("image/")) {
          await ctx.replyWithPhoto(fp.url, { message_thread_id: threadId }).catch(() => { })
        } else {
          await ctx.replyWithDocument(fp.url, { message_thread_id: threadId }).catch(() => { })
        }
        await new Promise((r) => setTimeout(r, 200))
      }

    } catch (err) {
      clearInterval(typingInterval)
      this.typingIntervals.delete(key)
      console.error("[opencode-telegram] Prompt error:", err)
      const msgText = err instanceof Error ? err.message : String(err)
      try {
        await ctx.api.editMessageText(chatId, placeholder.message_id, `⚠ Error: ${escapeMd(msgText.slice(0, 200))}`, {
          parse_mode: "MarkdownV2",
        })
      } catch {
        if (msgText.includes("ProviderAuthError") || msgText.includes("API key")) {
          await ctx.reply("Provider authentication error. Please check your API key configuration.", {
            message_thread_id: threadId,
          })
        } else {
          await this.sendWithFallback(ctx, `Error: ${msgText.slice(0, 200)}`)
        }
      }
    }
  }

  private async handleUserMessage(ctx: Context, chatId: number, threadId?: number): Promise<void> {
    await this.sendToChat(ctx, chatId, threadId, [])
  }

  private async buildMessageParts(ctx: Context): Promise<any[]> {
    const msg = ctx.msg!
    const parts: any[] = []

    if (msg.text) parts.push({ type: "text", text: msg.text })
    if (msg.caption) parts.push({ type: "text", text: msg.caption })

    if (msg.photo) {
      const photo = msg.photo[msg.photo.length - 1]
      const file = await this.bot.api.getFile(photo.file_id)
      if (file.file_path) {
        parts.push({
          type: "file",
          mime: "image/jpeg",
          url: `https://api.telegram.org/file/bot${this.bot.token}/${file.file_path}`,
        })
      }
    }

    if (msg.document) {
      const file = await this.bot.api.getFile(msg.document.file_id)
      if (file.file_path) {
        parts.push({
          type: "file",
          mime: msg.document.mime_type || "application/octet-stream",
          filename: msg.document.file_name,
          url: `https://api.telegram.org/file/bot${this.bot.token}/${file.file_path}`,
        })
      }
    }

    if (msg.voice) {
      const file = await this.bot.api.getFile(msg.voice.file_id)
      if (file.file_path) {
        parts.push({
          type: "file",
          mime: "audio/ogg",
          filename: "voice.ogg",
          url: `https://api.telegram.org/file/bot${this.bot.token}/${file.file_path}`,
        })
      }
    }

    if (msg.audio) {
      const file = await this.bot.api.getFile(msg.audio.file_id)
      if (file.file_path) {
        parts.push({
          type: "file",
          mime: msg.audio.mime_type || "audio/mpeg",
          filename: msg.audio.file_name || "audio",
          url: `https://api.telegram.org/file/bot${this.bot.token}/${file.file_path}`,
        })
      }
    }

    if (msg.video) {
      const file = await this.bot.api.getFile(msg.video.file_id)
      if (file.file_path) {
        parts.push({
          type: "file",
          mime: msg.video.mime_type || "video/mp4",
          filename: "video.mp4",
          url: `https://api.telegram.org/file/bot${this.bot.token}/${file.file_path}`,
        })
      }
    }

    // Sticker support - download static stickers as image
    if (msg.sticker) {
      try {
        const file = await this.bot.api.getFile(msg.sticker.file_id)
        if (file.file_path) {
          const isAnimated = msg.sticker.is_animated || msg.sticker.is_video
          if (!isAnimated) {
            parts.push({
              type: "file",
              mime: "image/webp",
              url: `https://api.telegram.org/file/bot${this.bot.token}/${file.file_path}`,
            })
          }
          // Animated/video stickers - skip with text note
          if (!parts.length) {
            parts.push({
              type: "text",
              text: `[Sticker: ${msg.sticker.emoji || "sticker"}]`,
            })
          }
        }
      } catch { }
    }

    // Animation (GIF) support
    if (msg.animation) {
      try {
        const file = await this.bot.api.getFile(msg.animation.file_id)
        if (file.file_path) {
          parts.push({
            type: "file",
            mime: msg.animation.mime_type || "video/mp4",
            filename: msg.animation.file_name || "animation.mp4",
            url: `https://api.telegram.org/file/bot${this.bot.token}/${file.file_path}`,
          })
        }
      } catch { }
    }

    // Location support
    if (msg.location) {
      const lat = msg.location.latitude
      const lon = msg.location.longitude
      parts.push({
        type: "text",
        text: `[Location: ${lat}, ${lon}](https://maps.google.com/?q=${lat},${lon})`,
      })
    }

    // Venue support
    if (msg.venue) {
      const { latitude, longitude } = msg.venue.location
      const title = msg.venue.title || ""
      const address = msg.venue.address || ""
      parts.push({
        type: "text",
        text: `[Venue: ${title} — ${address}](https://maps.google.com/?q=${latitude},${longitude})`,
      })
    }

    // Contact support
    if (msg.contact) {
      const name = `${msg.contact.first_name || ""} ${msg.contact.last_name || ""}`.trim()
      const phone = msg.contact.phone_number || ""
      parts.push({
        type: "text",
        text: `[Contact: ${name} — ${phone}]`,
      })
    }

    // Poll support
    if (msg.poll) {
      const question = msg.poll.question || ""
      const options = (msg.poll.options || []).map((o: any) => o.text).join(", ")
      parts.push({
        type: "text",
        text: `[Poll: ${question} — Options: ${options}]`,
      })
    }

    return parts
  }

  async requestApproval(permission: TelegramPermission): Promise<"allow" | "deny"> {
    const resolved = this.resolveChatId(permission)
    if (!resolved) return "deny"
    const { chatId, threadId } = resolved

    const buttons = [
      [{ text: "✅ Approve", callback_data: `allow:${permission.id}` }],
      [{ text: "❌ Deny", callback_data: `deny:${permission.id}` }],
      [{ text: "Dismiss", callback_data: `dismiss:${permission.id}` }],
    ]

    const title = permission.title || "Tool execution"
    const pattern = permission.pattern || ""
    const meta = permission.metadata || {}
    const extraInfo = Object.entries(meta)
      .filter(([k]) => k !== "sessionID")
      .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
      .join("\n")

    const message = [
      `*Permission Requested*`,
      ``,
      `${escapeMarkdown(title)}`,
      pattern ? `\`${escapeMarkdown(String(pattern))}\`` : "",
      extraInfo ? `\n${escapeMarkdown(extraInfo)}` : "",
    ]
      .filter(Boolean)
      .join("\n")

    const result = await this.bot.api.sendMessage(chatId, message, {
      parse_mode: "MarkdownV2",
      message_thread_id: threadId,
      reply_markup: { inline_keyboard: buttons },
    })

    const d = deferred<"allow" | "deny">()
    this.pendingApprovals.set(permission.id, {
      permission,
      chatId,
      threadId,
      messageId: result.message_id,
      resolve: d.resolve,
    })

    const timeout = setTimeout(() => {
      const p = this.pendingApprovals.get(permission.id)
      if (p) {
        p.resolve("deny")
        this.pendingApprovals.delete(permission.id)
        void this.bot.api.editMessageText(
          chatId,
          result.message_id,
          message + "\n\n_Request timed out_",
          { parse_mode: "MarkdownV2" },
        )
      }
    }, APPROVAL_TIMEOUT_MS)

    const action = await d.promise
    clearTimeout(timeout)
    return action
  }

  private async sendWithFallback(ctx: Context, text: string): Promise<void> {
    try {
      await ctx.reply(text, { parse_mode: "MarkdownV2" })
    } catch {
      await ctx.reply(stripFormatting(text))
    }
  }

  private resolveChatId(permission: TelegramPermission): { chatId: number; threadId?: number } | null {
    const fromChatMap = this.sessionChatMap.get(permission.sessionID)
    if (fromChatMap) return fromChatMap

    for (const [key, sid] of Object.entries(this.sessionMap)) {
      if (sid === permission.sessionID) {
        const chatId = parseInt(key.split(":")[0], 10)
        const threadId = key.includes(":") ? parseInt(key.split(":")[1], 10) : undefined
        if (!isNaN(chatId)) {
          this.sessionChatMap.set(permission.sessionID, { chatId, threadId })
          return { chatId, threadId }
        }
      }
    }
    return null
  }
}
