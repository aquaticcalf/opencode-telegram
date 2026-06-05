import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdtempSync, readFileSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { loadSessionMap, saveSessionMap } from "../plugin/session.js"

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "opencode-telegram-test-"))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

describe("session map persistence", () => {
  it("returns empty map when file does not exist", () => {
    const map = loadSessionMap(join(tmpDir, "nonexistent.json"))
    expect(map).toEqual({})
  })

  it("saves and loads a session map", () => {
    const path = join(tmpDir, "sessions.json")
    saveSessionMap(path, { "12345": "session-abc" })
    const loaded = loadSessionMap(path)
    expect(loaded).toEqual({ "12345": "session-abc" })
  })

  it("overwrites existing session map", () => {
    const path = join(tmpDir, "sessions.json")
    saveSessionMap(path, { "12345": "session-abc" })
    saveSessionMap(path, { "67890": "session-xyz" })
    const loaded = loadSessionMap(path)
    expect(loaded).toEqual({ "67890": "session-xyz" })
  })

  it("handles multiple entries", () => {
    const path = join(tmpDir, "sessions.json")
    const map = {
      "12345": "session-abc",
      "12345:678": "session-def",
      "99999": "session-xyz",
    }
    saveSessionMap(path, map)
    expect(loadSessionMap(path)).toEqual(map)
  })

  it("creates parent directories automatically", () => {
    const path = join(tmpDir, "nested", "subdir", "sessions.json")
    saveSessionMap(path, { "12345": "session-abc" })
    expect(readFileSync(path, "utf-8")).toContain("session-abc")
  })
})
