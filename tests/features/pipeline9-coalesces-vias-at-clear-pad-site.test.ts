import { expect, test } from "bun:test"
import { getNewViaPadViolations } from "@tscircuit/repair04"
import { coalesceOverlappingSameNetVias } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/coalesceOverlappingSameNetVias"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { SimpleRouteJson } from "lib/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("coalesces overlapping drills at the existing site with declared pad clearance", (): void => {
  const routes: HighDensityRoute[] = [0, 0.1].map(
    (viaX, i): HighDensityRoute => ({
      connectionName: `branch_${i}`,
      rootConnectionName: "shared_net",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: -1, y: i, z: 0 },
        { x: viaX, y: 0, z: 0 },
        { x: viaX, y: 0, z: 1 },
        { x: 1, y: i, z: 1 },
      ],
      vias: [{ x: viaX, y: 0 }],
    }),
  )
  const srj: SimpleRouteJson = {
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaEdgeToPadEdgeClearance: 0.1,
    connections: routes.map((route) => ({
      name: route.connectionName,
      __netConnectionName: "shared_net",
      pointsToConnect: [],
    })),
    obstacles: [
      {
        type: "rect",
        center: { x: -0.24, y: 0 },
        width: 0.02,
        height: 0.1,
        layers: ["top"],
        connectedTo: ["shared_net"],
      },
    ],
  }
  const original = structuredClone(routes)
  const output = coalesceOverlappingSameNetVias({
    routes,
    connMap: getConnectivityMapFromSimpleRouteJson(srj),
    viaHoleDiameter: 0.15,
    srj,
  })

  expect(routes).toEqual(original)
  expect(output.map((route) => route.vias)).toEqual([
    [{ x: 0.1, y: 0 }],
    [{ x: 0.1, y: 0 }],
  ])
  expect(
    getNewViaPadViolations({
      srj: { ...srj, traces: undefined },
      previousRoutes: routes,
      routes: output,
    }),
  ).toEqual([])
  for (let i = 0; i < routes.length; i++) {
    expect(output[i]!.route[0]).toEqual(routes[i]!.route[0])
    expect(output[i]!.route.at(-1)).toEqual(routes[i]!.route.at(-1))
  }
})
