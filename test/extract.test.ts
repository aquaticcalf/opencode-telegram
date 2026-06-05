import { describe, it, expect } from "vitest"
import { extractText } from "../plugin/extract.js"

describe("extractText", () => {
  it("extracts text from text parts", () => {
    const parts = [
      { type: "text", text: "Hello" },
      { type: "text", text: "World" },
    ]
    expect(extractText(parts)).toBe("Hello\nWorld")
  })

  it("extracts tool info from tool parts", () => {
    const parts = [{ type: "tool", tool: "read_file", result: "file content" }]
    expect(extractText(parts)).toBe("[Tool: read_file]")
  })

  it("returns empty string for empty parts", () => {
    expect(extractText([])).toBe("")
  })

  it("handles mixed text and tool parts", () => {
    const parts = [
      { type: "text", text: "Running tool..." },
      { type: "tool", tool: "bash", result: "done" },
      { type: "text", text: "Finished" },
    ]
    expect(extractText(parts)).toBe("Running tool...\n[Tool: bash]\nFinished")
  })

  it("ignores parts with unknown type", () => {
    const parts = [
      { type: "unknown", data: "something" },
      { type: "text", text: "visible" },
    ]
    expect(extractText(parts)).toBe("visible")
  })
})
