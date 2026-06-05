import { writeFileSync, unlinkSync, readFileSync, mkdirSync } from "fs"
import { join } from "path"
import { createHash } from "crypto"
import type { Deferred } from "./types.js"

export function acquireTokenLock(token: string, lockDir: string): boolean {
  mkdirSync(lockDir, { recursive: true })
  const hash = createHash("sha256").update(token).digest("hex").slice(0, 16)
  const lockPath = join(lockDir, `telegram-${hash}.lock`)
  const data = JSON.stringify({ pid: process.pid, time: Date.now() })

  try {
    writeFileSync(lockPath, data, { flag: "wx" })
    return true
  } catch {
    try {
      const existing = JSON.parse(readFileSync(lockPath, "utf-8"))
      try {
        process.kill(existing.pid, 0)
        return false
      } catch {
        unlinkSync(lockPath)
        writeFileSync(lockPath, data, { flag: "wx" })
        return true
      }
    } catch {
      return false
    }
  }
}

export function releaseTokenLock(token: string, lockDir: string): void {
  const hash = createHash("sha256").update(token).digest("hex").slice(0, 16)
  const lockPath = join(lockDir, `telegram-${hash}.lock`)
  try {
    const existing = JSON.parse(readFileSync(lockPath, "utf-8"))
    if (existing.pid === process.pid) {
      unlinkSync(lockPath)
    }
  } catch {}
}

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
