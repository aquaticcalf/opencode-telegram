import { readFileSync, writeFileSync, mkdirSync } from "fs"
import { dirname } from "path"
import type { SessionMap } from "./types.js"

export function loadSessionMap(path: string): SessionMap {
  try {
    const text = readFileSync(path, "utf-8")
    return JSON.parse(text)
  } catch {
    return {}
  }
}

export function saveSessionMap(path: string, map: SessionMap): void {
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(map, null, 2))
  } catch {
    // best-effort persistence
  }
}
