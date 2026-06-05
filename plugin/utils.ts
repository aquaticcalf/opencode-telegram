import type { Deferred } from "./types.js"

export function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((r, j) => {
    resolve = r
    reject = j
  })
  return { promise, resolve, reject }
}

export function escapeMarkdown(text: string): string {
  return text
    .replace(/_/g, "\\_")
    .replace(/\*/g, "\\*")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/~/g, "\\~")
    .replace(/`/g, "\\`")
    .replace(/</g, "\\<")
    .replace(/>/g, "\\>")
    .replace(/&/g, "\\&")
    .replace(/#/g, "\\#")
    .replace(/\+/g, "\\+")
    .replace(/-/g, "\\-")
    .replace(/=/g, "\\=")
    .replace(/\|/g, "\\|")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/\./g, "\\.")
    .replace(/!/g, "\\!")
}

export function splitLongMessage(text: string, maxLen = 4096): string[] {
  if (text.length <= maxLen) return [text]
  const chunks: string[] = []
  let remaining = text
  while (remaining.length > 0) {
    let chunk = remaining.slice(0, maxLen)
    const newlineIdx = chunk.lastIndexOf("\n")
    const spaceIdx = chunk.lastIndexOf(" ")
    const splitAt =
      newlineIdx > maxLen * 0.5 ? newlineIdx : spaceIdx > maxLen * 0.5 ? spaceIdx : maxLen
    if (splitAt > 0 && splitAt < maxLen) {
      chunk = chunk.slice(0, splitAt)
    }
    chunks.push(chunk)
    remaining = remaining.slice(chunk.length)
  }
  return chunks
}

export function stripFormatting(text: string): string {
  return text
    .replace(/[_*[\]()~`>#+\-=|{}.!]/g, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/`(.+?)`/g, "$1")
}

export function chatKey(chatId: number, threadId?: number): string {
  return threadId ? `${chatId}:${threadId}` : `${chatId}`
}
