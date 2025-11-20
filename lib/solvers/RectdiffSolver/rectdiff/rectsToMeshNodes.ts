// lib/solvers/rectdiff/rectsToMeshNodes.ts
import type { Rect3d } from "./types"
import type { CapacityMeshNode } from "lib/types/capacity-mesh-types"

export function rectsToMeshNodes(rects: Rect3d[]): CapacityMeshNode[] {
  let id = 0
  const out: CapacityMeshNode[] = []
  for (const r of rects) {
    const w = Math.max(0, r.maxX - r.minX)
    const h = Math.max(0, r.maxY - r.minY)
    if (w <= 0 || h <= 0 || r.zLayers.length === 0) continue
    out.push({
      capacityMeshNodeId: `cmn_${id++}`,
      center: { x: (r.minX + r.maxX) / 2, y: (r.minY + r.maxY) / 2 },
      width: w,
      height: h,
      layer: "top",
      availableZ: r.zLayers.slice(),
    })
  }
  return out
}
