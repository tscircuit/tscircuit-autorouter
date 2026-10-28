import { expect, test } from "bun:test"
import { legalizeHighDensityRouteProposal } from "lib/solvers/HighDensitySolver/legalizeHighDensityRouteProposal"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import { doPipeline9RoutesHaveCopperConflict } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"

test("physical legalization moves a grown via away from copper without moving terminals or changing layers", () => {
  const routes: HighDensityIntraNodeRoute[] = [
    { connectionName: "via-net", traceThickness: 0.1, viaDiameter: 0.3,
      route: [{ x: -1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 1 }],
      vias: [{ x: 0, y: 0 }] },
    { connectionName: "wire-net", traceThickness: 0.1, viaDiameter: 0.3,
      route: [{ x: -1, y: 0.22, z: 0 }, { x: 1, y: 0.22, z: 0 }], vias: [] },
  ]
  const original = structuredClone(routes)
  const result = legalizeHighDensityRouteProposal({ routes, node: { capacityMeshNodeId: "test", center: { x: 0, y: 0 },
    width: 3, height: 3, portPoints: [] }, layerCount: 2, clearance: 0.1 })
  expect(result.status).toBe("clean")
  expect(result.copperPairsBefore).toBe(1)
  expect(result.copperPairsAfter).toBe(0)
  expect(doPipeline9RoutesHaveCopperConflict({ left: result.routes[0]!, right: result.routes[1]!, clearance: 0.1, layerCount: 2 })).toBe(false)
  expect(result.routes[0]!.route[0]).toEqual(original[0]!.route[0])
  expect(result.routes[0]!.route.at(-1)).toEqual(original[0]!.route.at(-1))
  expect(result.routes[0]!.route.map((point) => point.z)).toEqual([0, 0, 1, 1])
  expect(result.routes[0]!.vias[0]!.y).toBeLessThan(-0.079)
  expect(result.routes[0]!.route[1]!.x).toBe(result.routes[0]!.vias[0]!.x)
  expect(result.routes[0]!.route[2]!.y).toBe(result.routes[0]!.vias[0]!.y)
  expect(result.routes[0]!.traceThickness).toBe(0.1)
  expect(result.routes[0]!.viaDiameter).toBe(0.3)
  expect(routes).toEqual(original)
})
