import { expect, test } from "bun:test"
import { computeOctagonalRegions } from "lib/autorouter-pipelines/AutoroutingPipeline6_PolyHypergraph/computeOctagonalRegions"
import type { SimpleRouteJson } from "lib/types"

test("octagonal free-space vertices preserve physical clearance from rotated rectangles and circles", () => {
  const srj: SimpleRouteJson = {
    layerCount: 2, minTraceWidth: 0.15,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 }, connections: [],
    obstacles: [
      { type: "rect", center: { x: 3, y: 5 }, width: 2, height: 1,
        ccwRotationDegrees: 22.5, layers: ["top"], connectedTo: [] },
      { type: "rect", shape: "circle", center: { x: 7, y: 5 }, width: 2, height: 2,
        layers: ["top"], connectedTo: [] },
    ],
  }
  const clearance = 0.225
  const result = computeOctagonalRegions(srj, clearance)
  for (const [i, polygon] of result.regions.entries()) {
    if (!result.availableZ[i]!.includes(0)) continue
    for (const point of polygon) {
      for (const obstacle of srj.obstacles) {
        const angle = (obstacle.ccwRotationDegrees ?? 0) * Math.PI / 180
        const dx = point.x - obstacle.center.x
        const dy = point.y - obstacle.center.y
        const x = dx * Math.cos(angle) + dy * Math.sin(angle)
        const y = -dx * Math.sin(angle) + dy * Math.cos(angle)
        const distance = obstacle.shape === "circle" ? Math.hypot(x, y) - 1 :
          Math.hypot(Math.max(0, Math.abs(x) - obstacle.width / 2),
            Math.max(0, Math.abs(y) - obstacle.height / 2))
        expect(distance).toBeGreaterThanOrEqual(clearance - 1e-8)
      }
    }
  }
})
