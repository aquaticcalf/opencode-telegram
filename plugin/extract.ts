import type { TelegramPart } from "./types.js"

export function extractText(parts: TelegramPart[]): string {
  let text = ""
  for (const p of parts) {
    if (p.type === "text") {
      if (p.text) text += p.text + "\n"
    } else if (p.type === "tool") {
      if (p.result) text += `[Tool: ${p.tool || ""}]\n`
    }
  }
  return text.trim()
}
