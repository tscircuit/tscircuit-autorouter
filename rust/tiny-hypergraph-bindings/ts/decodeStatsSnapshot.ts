import type { TinyHyperGraphStats } from "./types.js"

type StatsSnapshot = {
  stats: TinyHyperGraphStats
  undefinedPaths: Array<Array<string | number>>
}

export function decodeStatsSnapshot(json: string): TinyHyperGraphStats {
  const snapshot = JSON.parse(json) as StatsSnapshot
  // serde-wasm-bindgen represents Value::Null as an own undefined property.
  // JSON cannot express that distinction; restore only those recorded fields.
  for (const path of snapshot.undefinedPaths) {
    let target: Record<string | number, unknown> = snapshot.stats
    for (let index = 0; index < path.length - 1; index++) {
      target = target[path[index]!] as Record<string | number, unknown>
    }
    target[path[path.length - 1]!] = undefined
  }
  return snapshot.stats
}
