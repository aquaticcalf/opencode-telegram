import type { Bot, Context } from "grammy"
import type { BotConfig, PendingApproval, TelegramPermission, TelegramPart } from "./types.js"
import type { OpencodeClient } from "./client.js"
import { deferred, escapeMarkdown, splitLongMessage, chatKey } from "./utils.js"
import { loadSessionMap, saveSessionMap } from "./session.js"
import { extractText } from "./extract.js"

const APPROVAL_TIMEOUT_MS = 300_000
const TYPING_INTERVAL_MS = 5000

export class TelegramBot {
  private config: BotConfig
  private client: OpencodeClient
  private bot: Bot
  private sessionMap: Record<string, string>
  private sessionMapPath: string
  private pendingApprovals = new Map<string, PendingApproval>()
  private stopped = false
  private typingIntervals = new Map<string, ReturnType<typeof setInterval>>()

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
      const msg = ctx.msg!
      if (msg.left_chat_member || msg.new_chat_members || msg.group_chat_created) return

      const chatId = ctx.chat!.id
      const chatType = ctx.chat!.type
      const isGroup = chatType === "group" || chatType === "supergroup"
      const threadId = msg.message_thread_id || msg.reply_to_message?.message_id

      if (isGroup && this.config.groupChats === "deny") {
        const text = msg.text || msg.caption || ""
        const botUser = await this.bot.api.getMe()
        if (!text.includes(`@${botUser.username}`)) return
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
          } catch {
            /* already edited */
          }
        }
      } else if (action === "dismiss" && permissionId) {
        this.pendingApprovals.delete(permissionId)
        try {
          await ctx.deleteMessage()
        } catch {
          /* already deleted */
        }
      }
    })
  }

  start(): void {
    this.stopped = false
    void this.bot.start({
      allowed_updates: ["message", "callback_query", "channel_post"],
      onStart: () => console.log("[opencode-telegram] Bot started"),
    })
  }

  async stop(): Promise<void> {
    this.stopped = true
    for (const interval of this.typingIntervals.values()) {
      clearInterval(interval)
    }
    this.typingIntervals.clear()
    await this.bot.stop()
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
            "Forward messages to opencode via Telegram.\n" +
            "Supports images, documents, voice messages, and more.\n\n" +
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
          const result = await this.client.session.prompt({
            path: { id: sessionId },
            body: { parts: userParts },
          })
          const responseText = extractText(result?.data?.parts || [])
          if (responseText) {
            for (const chunk of splitLongMessage(responseText)) {
              await this.sendWithFallback(ctx, chunk)
            }
          }
        } catch {
          await ctx.reply("Failed to retry.", { message_thread_id: threadId })
        }
        break
      }

      default:
        await this.handleUserMessage(ctx, chatId, threadId)
    }
  }

  private async handleUserMessage(ctx: Context, chatId: number, threadId?: number): Promise<void> {
    const key = chatKey(chatId, threadId)
    let sessionId = this.sessionMap[key]

    if (!sessionId) {
      try {
        const session = await this.client.session.create({
          body: { title: `Telegram Chat ${chatId}` },
        })
        sessionId = (session.data?.id || session.id)!
        this.sessionMap[key] = sessionId
        saveSessionMap(this.sessionMapPath, this.sessionMap)
      } catch (err) {
        console.error("[opencode-telegram] Failed to create session:", err)
        await ctx.reply("Failed to start a session. Is the opencode server running?", {
          message_thread_id: threadId,
        })
        return
      }
    }

    const parts = await this.buildMessageParts(ctx)

    if (parts.length === 0) {
      await ctx.reply(
        "I received your message but couldn't process it. Please send text or a supported file type.",
        { message_thread_id: threadId },
      )
      return
    }

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

      const responseParts: TelegramPart[] = result?.data?.parts || []
      const responseText = extractText(responseParts)

      if (responseText) {
        for (const chunk of splitLongMessage(responseText)) {
          await this.sendWithFallback(ctx, chunk)
        }
      }
    } catch (err) {
      clearInterval(typingInterval)
      this.typingIntervals.delete(key)
      console.error("[opencode-telegram] Prompt error:", err)
      const msgText = err instanceof Error ? err.message : String(err)
      if (msgText.includes("ProviderAuthError") || msgText.includes("API key")) {
        await ctx.reply("Provider authentication error. Please check your API key configuration.", {
          message_thread_id: threadId,
        })
      } else {
        await this.sendWithFallback(
          ctx,
          `Error processing your message. Please try again.\n\`${msgText.slice(0, 200)}\``,
        )
      }
    }
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

    return parts
  }

  async requestApproval(permission: TelegramPermission): Promise<"allow" | "deny"> {
    const chatId = this.resolveChatId(permission)
    if (!chatId) return "deny"

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
      reply_markup: { inline_keyboard: buttons },
    })

    const d = deferred<"allow" | "deny">()
    this.pendingApprovals.set(permission.id, {
      permission,
      chatId,
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
      const cleaned = text
        .replace(/[_*[\]()~`>#+\-=|{}.!]/g, "")
        .replace(/\*\*(.+?)\*\*/g, "$1")
        .replace(/__(.+?)__/g, "$1")
        .replace(/`(.+?)`/g, "$1")
      await ctx.reply(cleaned)
    }
  }

  private resolveChatId(permission: TelegramPermission): number | null {
    for (const [key, sid] of Object.entries(this.sessionMap)) {
      if (sid === permission.sessionID) {
        return parseInt(key.split(":")[0], 10)
      }
    }
    return null
  }
}
