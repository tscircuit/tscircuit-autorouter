import { readFileSync } from "node:fs"
import type { SimpleRouteJson } from "lib/types"

export function getFreshE2e3(): SimpleRouteJson {
  const raw = readFileSync(
    new URL("../../fixtures/legacy/assets/e2e3.json", import.meta.url),
    "utf-8",
  )
  return JSON.parse(raw) as SimpleRouteJson
}
