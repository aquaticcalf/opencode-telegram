export type BotConfig = {
  token: string
  allowedUsers?: Set<number>
  groupChats: "allow" | "deny"
}

export type SessionMap = Record<string, string>

export type PendingApproval = {
  permission: TelegramPermission
  chatId: number
  threadId?: number
  messageId: number
  resolve: (action: "allow" | "deny") => void
}

export type Deferred<T> = {
  promise: Promise<T>
  resolve: (v: T) => void
  reject: (e: unknown) => void
}

export type TelegramPermission = {
  id: string
  type: string
  pattern?: string | Array<string>
  sessionID: string
  messageID: string
  callID?: string
  title: string
  metadata: { [key: string]: unknown }
  time: { created: number }
}

export type TelegramPart = {
  id?: string
  type: string
  text?: string
  tool?: string
  result?: string
  [key: string]: unknown
}
