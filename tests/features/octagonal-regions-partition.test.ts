import { expect, test } from "bun:test"
import { computeOctagonalRegions } from "lib/autorouter-pipelines/AutoroutingPipeline6_PolyHypergraph/computeOctagonalRegions"
import { getConvexHull, isPointInConvexPolygon } from "lib/autorouter-pipelines/AutoroutingPipeline6_PolyHypergraph/geometry"
import type { SimpleRouteJson } from "lib/types"
import { polyArea } from "pcb-poly-hyper-graph"

test("octagonal subtraction conserves area and layers around overlapping, rotated and board-edge obstacles", () => {
  const srj: SimpleRouteJson = {
    layerCount: 2, minTraceWidth: 0.1,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 }, connections: [],
    obstacles: [
      { type: "rect", center: { x: 5, y: 5 }, width: 2, height: 2,
        layers: ["top"], connectedTo: ["pad"] },
      { type: "rect", center: { x: 6, y: 5 }, width: 2, height: 1,
        ccwRotationDegrees: 22.5, layers: ["top"], connectedTo: ["pad2"] },
      { type: "rect", center: { x: 0, y: 2 }, width: 1, height: 2,
        ccwRotationDegrees: 45, layers: ["top"], connectedTo: ["edge"] },
    ],
  }
  const result = computeOctagonalRegions(srj, 0.2)
  expect(result.obstacleRegions).toHaveLength(3)
  expect(result.availableZ.flat()).toContain(0)
  const bottomArea = result.regions.reduce((area, region, i) =>
    area + (result.availableZ[i]!.includes(1) ? polyArea(region) : 0), 0)
  expect(bottomArea).toBeCloseTo(100, 8)
  for (const polygon of result.regions) {
    const hull = getConvexHull(polygon)
    expect(hull.length).toBeLessThanOrEqual(8)
    expect(polyArea(polygon)).toBeCloseTo(polyArea(hull), 8)
    for (let i = 0; i < hull.length; i++) {
      const a = hull[i]!
      const b = hull[(i + 1) % hull.length]!
      expect(Math.min(Math.abs(a.x - b.x), Math.abs(a.y - b.y),
        Math.abs(Math.abs(a.x - b.x) - Math.abs(a.y - b.y)))).toBeLessThan(1e-7)
    }
  }
  // Offset samples avoid seams. Every layer has exactly one owner unless blocked.
  for (let x = 0.037; x < 10; x += 0.19) {
    for (let y = 0.061; y < 10; y += 0.23) {
      const point = { x, y }
      for (const z of [0, 1]) {
        const blocked = result.obstacleRegions.some((obstacle) =>
          obstacle.availableZ!.includes(z) && isPointInConvexPolygon(point, obstacle.polygon))
        const owners = result.regions.filter((polygon, i) =>
          result.availableZ[i]!.includes(z) && isPointInConvexPolygon(point, polygon))
        expect(owners.length).toBe(blocked ? 0 : 1)
      }
    }
  }
})
