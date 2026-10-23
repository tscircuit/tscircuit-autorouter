import { expect, test } from "bun:test"
import { pointToSegmentDistance } from "@tscircuit/math-utils"
import { minimumDistanceBetweenSegments } from "../../lib/utils/minimumDistanceBetweenSegments"
import { constructPipeline9MonotoneFamily } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/constructPipeline9MonotoneFamily"
import { getPipeline9RouteCopperGeometry } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import type { MonotoneLaneTemplateCache } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/compileMonotoneLaneTemplate"

test("collective via ladder compiles and reuses affine active blocks while retaining actual overhanging endpoints", () => {
  const cache: MonotoneLaneTemplateCache = new Map()
  for (const [sample, spacing] of [0.4, 0.4, 2].entries()) {
    const offsetX = sample * 30, offsetY = sample * 5
    const node = { capacityMeshNodeId: `cell${sample}`, center: { x: offsetX, y: offsetY }, width: 20, height: 6, portPoints: [-spacing, 0, spacing].flatMap((y, i) => [{ x: offsetX - 10.00005, y: offsetY + y, z: 0, connectionName: `n${i}` }, { x: offsetX + 10.00005, y: offsetY + y, z: 1, connectionName: `n${i}` }]) }
    const result = constructPipeline9MonotoneFamily({ node, traceWidth: 0.15, clearance: 0.15, viaDiameter: 0.6, viaHoleDiameter: 0.3, viaHoleClearance: 0.1, obstacles: [], layerCount: 2, scenePorts: node.portPoints, sceneRoutes: [], cache })
    expect(result.applicable).toBe(true)
    expect(result.routes).toHaveLength(3)
    expect(result.stats.monotoneFamilyOverhangingPorts).toBe(6)
    if (sample === 0) { expect(result.stats.monotoneFamilyContinuousSolves).toBe(1); expect(result.stats.monotoneFamilyActiveBlockMerges).toBe(2) }
    if (sample === 1) { expect(result.stats.monotoneFamilyTemplateCacheHits).toBe(1); expect(result.stats.monotoneFamilyContinuousSolves).toBe(0) }
    if (sample === 2) { expect(result.stats.monotoneFamilyTemplateDomainRejections).toBeGreaterThan(0); expect(result.stats.monotoneFamilyContinuousSolves).toBe(1) }
    const geometries = result.routes.map((route) => getPipeline9RouteCopperGeometry(route, { layerCount: 2 }))
    for (let i = 0; i < result.routes.length; i++) {
      const route = result.routes[i]!
      expect(route.traceThickness).toBe(0.15)
      expect(route.route[0]).toEqual({ x: node.portPoints[2 * i]!.x, y: node.portPoints[2 * i]!.y, z: 0 })
      expect(route.route.at(-1)).toEqual({ x: node.portPoints[2 * i + 1]!.x, y: node.portPoints[2 * i + 1]!.y, z: 1 })
      expect(route.vias).toHaveLength(1)
      for (let j = 0; j < i; j++) {
        const first = geometries[i]!, second = geometries[j]!
        for (const a of first.wireSegments) for (const b of second.wireSegments) if (a.z === b.z) expect(minimumDistanceBetweenSegments(a.start, a.end, b.start, b.end)).toBeGreaterThanOrEqual(0.3)
        for (const a of first.viaSpans) for (const b of second.viaSpans) expect(Math.hypot(a.center.x - b.center.x, a.center.y - b.center.y)).toBeGreaterThanOrEqual(0.75)
        for (const a of first.viaSpans) for (const b of second.wireSegments) expect(pointToSegmentDistance(a.center, b.start, b.end)).toBeGreaterThanOrEqual(0.525)
        for (const a of second.viaSpans) for (const b of first.wireSegments) expect(pointToSegmentDistance(a.center, b.start, b.end)).toBeGreaterThanOrEqual(0.525)
      }
    }
  }
})
