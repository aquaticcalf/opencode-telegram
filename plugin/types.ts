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

// Types that match opencode SDK V1 Part types
export type SdkTextPart = { id: string; type: "text"; text: string; synthetic?: boolean }
export type SdkToolPart = {
  id: string
  type: "tool"
  callID: string
  tool: string
  state:
    | { status: "pending" | "running"; input: Record<string, unknown> }
    | { status: "completed"; input: Record<string, unknown>; output: string; title: string }
    | { status: "error"; input: Record<string, unknown>; error: string }
}
export type SdkFilePart = { id: string; type: "file"; mime: string; url: string; filename?: string }
export type SdkReasoningPart = { id: string; type: "reasoning"; text: string }
export type SdkPart = SdkTextPart | SdkToolPart | SdkFilePart | SdkReasoningPart
