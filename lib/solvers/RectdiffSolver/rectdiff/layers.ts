// lib/solvers/rectdiff/layers.ts
import type { SimpleRouteJson, Obstacle } from "lib/types/srj-types"
import type { XYRect } from "./types"

function layerSortKey(n: string) {
  const L = n.toLowerCase()
  if (L === "top") return -1_000_000
  if (L === "bottom") return 1_000_000
  const m = /^inner(\d+)$/i.exec(L)
  if (m) return parseInt(m[1]!, 10) || 0
  return 100 + L.charCodeAt(0)
}

export function canonicalizeLayerOrder(names: string[]) {
  return Array.from(new Set(names)).sort((a, b) => {
    const ka = layerSortKey(a)
    const kb = layerSortKey(b)
    if (ka !== kb) return ka - kb
    return a.localeCompare(b)
  })
}

export function buildZIndexMap(srj: SimpleRouteJson) {
  const names = canonicalizeLayerOrder(
    (srj.obstacles ?? []).flatMap((o) => o.layers ?? []),
  )
  const fallback = Array.from(
    { length: Math.max(1, srj.layerCount || 1) },
    (_, i) =>
      i === 0
        ? "top"
        : i === (srj.layerCount || 1) - 1
          ? "bottom"
          : `inner${i}`,
  )
  const layerNames = names.length ? names : fallback
  const map = new Map<string, number>()
  layerNames.forEach((n, i) => map.set(n, i))
  return { layerNames, zIndexByName: map }
}

export function obstacleZs(ob: Obstacle, zIndexByName: Map<string, number>) {
  if (ob.zLayers?.length)
    return Array.from(new Set(ob.zLayers)).sort((a, b) => a - b)
  const fromNames = (ob.layers ?? [])
    .map((n) => zIndexByName.get(n))
    .filter((v): v is number => typeof v === "number")
  return Array.from(new Set(fromNames)).sort((a, b) => a - b)
}

export function obstacleToXYRect(ob: Obstacle): XYRect | null {
  const w = ob.width as any
  const h = ob.height as any
  if (typeof w !== "number" || typeof h !== "number") return null
  return { x: ob.center.x - w / 2, y: ob.center.y - h / 2, width: w, height: h }
}
