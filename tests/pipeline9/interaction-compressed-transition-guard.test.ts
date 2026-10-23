import { test, expect } from "bun:test"
import { getInteractionGuardRoutes } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9InteractionGroupedHighDensitySolver"
import { getPipeline9RouteCopperGeometry } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("guard-only transition expansion preserves native compressed copper and route identity", () => {
  const stats = { experimentalInteractionCanonicalTransitionVertices: 0 }
  for (const endpoint of ["start", "end"] as const) {
    const original: HighDensityRoute = { connectionName: "a", rootConnectionName: "root-a", startPcbPortId: "start", endPcbPortId: "end", traceThickness: 0.1, viaDiameter: 0.3, route: [{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 1 }], vias: [{ x: endpoint === "start" ? 0 : 2, y: 0 }] }
    const copy = getInteractionGuardRoutes([original], stats)[0]!
    expect(original.route).toHaveLength(2)
    expect(copy.route).toHaveLength(3)
    expect(copy.route[1]).toMatchObject({ x: endpoint === "start" ? 0 : 2, y: 0, z: endpoint === "start" ? 1 : 0 })
    expect(copy.startPcbPortId).toBe("start")
    expect(copy.endPcbPortId).toBe("end")
    const before = getPipeline9RouteCopperGeometry(original, { layerCount: 4 })
    const after = getPipeline9RouteCopperGeometry(copy, { layerCount: 4 })
    const wires = (geometry: typeof before) => geometry.wireSegments.map(wire => [wire.start.x, wire.start.y, wire.end.x, wire.end.y, wire.z, wire.width])
    expect(wires(after)).toEqual(wires(before))
    expect(after.viaSpans).toEqual(before.viaSpans)
  }
  expect(stats.experimentalInteractionCanonicalTransitionVertices).toBe(2)
})
