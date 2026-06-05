import type { SdkPart } from "./types.js"

const SEP = "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

export function escapeMd(text: string): string {
  return text
    .replace(/_/g, "\\_").replace(/\*/g, "\\*").replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]").replace(/\(/g, "\\(").replace(/\)/g, "\\)")
    .replace(/~/g, "\\~").replace(/`/g, "\\`").replace(/>/g, "\\>")
    .replace(/#/g, "\\#").replace(/\+/g, "\\+").replace(/-/g, "\\-")
    .replace(/=/g, "\\=").replace(/\|/g, "\\|").replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}").replace(/\./g, "\\.").replace(/!/g, "\\!")
}

export function extractText(parts: SdkPart[]): string {
  const textParts = parts.filter((p): p is SdkPart & { type: "text" } => p.type === "text" && "text" in p && !!p.text)
  return textParts.map((p) => (p as any).text).join("\n").trim()
}

export function formatToolResult(part: SdkPart & { type: "tool" }): string {
  const toolName = escapeMd(part.tool)
  if (part.state.status === "completed") {
    const output = part.state.output.length > 1500
      ? part.state.output.slice(0, 1500) + "\n…"
      : part.state.output
    const title = part.state.title ? escapeMd(part.state.title) : ""
    const inputStr = JSON.stringify(part.state.input, null, 2)
    const truncatedInput = inputStr.length > 300 ? inputStr.slice(0, 300) + "\n…" : inputStr
    const lines = [`🔧 *${toolName}*`]
    if (title) lines.push(title)
    lines.push("")
    lines.push("```\n" + truncatedInput + "\n```")
    if (output) {
      lines.push("")
      lines.push("```\n" + output + "\n```")
      lines.push("")
    }
    return lines.join("\n")
  }
  if (part.state.status === "error") {
    return `🔧 *${toolName}*\n⚠ Error: ${escapeMd(part.state.error)}`
  }
  return `🔧 *${toolName}*`
}
