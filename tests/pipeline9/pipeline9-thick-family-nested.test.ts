import { expect, test } from "bun:test"
import { constructPipeline9ThickFamily } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/constructPipeline9ThickFamily"
import { minimumDistanceBetweenSegments } from "../../lib/utils/minimumDistanceBetweenSegments"
import type { NodeWithPortPoints } from "../../lib/types/high-density-types"

test("collective depth construction separates nested, side-turning, and through families at nominal width", () => {
  const families = [
    [[-4, -3, 4, -3], [-3, -3, 3, -3], [-2, -3, 2, -3]],
    [[-5, -2, 2, -3], [-5, -1, 3, -3], [-5, 0, 4, -3]],
    [[-5, -2, 5, -2], [-5, 0, 5, 0], [-5, 2, 5, 2]],
  ]
  for (const family of families) {
    const node: NodeWithPortPoints = { capacityMeshNodeId: "test", center: { x: 0, y: 0 }, width: 10, height: 6,
      portPoints: family.flatMap(([ax, ay, bx, by], i) => [{ x: ax!, y: ay!, z: 0, connectionName: `n${i}`, portPointId: `a${i}` }, { x: bx!, y: by!, z: 0, connectionName: `n${i}`, portPointId: `b${i}` }]) }
    const result = constructPipeline9ThickFamily({ node, traceWidth: 0.2, clearance: 0.15, viaDiameter: 0.6, obstacles: [], layerCount: 2, scenePorts: node.portPoints, sceneRoutes: [] })
    expect(result.applicable).toBe(true)
    expect(result.routes).toHaveLength(3)
    expect(result.stats.thickFamilyReservedRectangles).toBeGreaterThan(0)
    for (let i = 0; i < result.routes.length; i++) {
      const route = result.routes[i]!
      expect(route.traceThickness).toBe(0.2)
      expect(route.vias).toEqual([])
      expect(route.route[0]).toEqual({ x: family[i]![0], y: family[i]![1], z: 0 })
      expect(route.route.at(-1)).toEqual({ x: family[i]![2], y: family[i]![3], z: 0 })
      for (const point of route.route) { expect(Math.abs(point.x)).toBeLessThanOrEqual(5); expect(Math.abs(point.y)).toBeLessThanOrEqual(3) }
      for (let j = 0; j < i; j++) for (let a = 1; a < route.route.length; a++) for (let b = 1; b < result.routes[j]!.route.length; b++) {
        expect(minimumDistanceBetweenSegments(route.route[a - 1]!, route.route[a]!, result.routes[j]!.route[b - 1]!, result.routes[j]!.route[b]!)).toBeGreaterThanOrEqual(0.35)
      }
    }
  }
})
