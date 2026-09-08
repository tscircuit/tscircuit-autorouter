import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { coalesceOverlappingSameNetVias } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/coalesceOverlappingSameNetVias"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("shares overlapping drills without moving terminals or foreign-net vias", () => {
  const createRoute = (connectionName: string, viaX: number): HighDensityRoute => ({
    connectionName,
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -1, y: 0, z: 0 },
      { x: viaX, y: 0, z: 0 },
      { x: viaX, y: 0, z: 1 },
      { x: 1, y: 0, z: 1 },
    ],
    vias: [{ x: viaX, y: 0 }],
  })
  const routes = [
    createRoute("first", 0),
    createRoute("second", 0.02),
    createRoute("foreign", 0.03),
    {
      connectionName: "branch",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [{ x: 0.02, y: 0, z: 0 }, { x: 0.02, y: 1, z: 0 }],
      vias: [],
    },
  ] satisfies HighDensityRoute[]
  const original = structuredClone(routes)
  const connMap = new ConnectivityMap({})
  connMap.addConnections([["first", "second", "branch"]])
  const result = coalesceOverlappingSameNetVias({
    routes,
    connMap,
    viaHoleDiameter: 0.15,
    srj: {
      bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
      layerCount: 2,
      minTraceWidth: 0.1,
      obstacles: [],
      connections: [],
    },
  })

  expect(routes).toEqual(original)
  expect(result[0]!.vias).toEqual([{ x: 0.02, y: 0 }])
  expect(result[0]!.route.slice(1, 3)).toEqual([
    { x: 0.02, y: 0, z: 0 },
    { x: 0.02, y: 0, z: 1 },
  ])
  expect(result[0]!.route[0]).toEqual(original[0]!.route[0])
  expect(result[0]!.route.at(-1)).toEqual(original[0]!.route.at(-1))
  expect(result[1]).toEqual(original[1])
  expect(result[2]).toEqual(original[2])
  expect(result[3]).toEqual(original[3])
})
