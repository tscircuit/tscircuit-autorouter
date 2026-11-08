import { expect, test } from "bun:test"
import { PhysicalConnectivityInvariant } from "@tscircuit/power-trace-expander"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { Pipeline9PlanarShortcutSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9PlanarShortcutSolver"

test("a planar shortcut cannot disconnect an existing same-net branch", (): void => {
  const srj = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -1, maxX: 5, minY: -1, maxY: 4 },
    obstacles: [],
    connections: [
      {
        name: "rail",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top", pcb_port_id: "a" },
          { x: 4, y: 0, layer: "top", pcb_port_id: "b" },
        ],
      },
      {
        name: "branch",
        pointsToConnect: [
          { x: 2, y: 2, layer: "top", pcb_port_id: "tap" },
          { x: 2, y: 3, layer: "top", pcb_port_id: "c" },
        ],
      },
    ],
  } satisfies SimpleRouteJson
  const routes: HighDensityRoute[] = [
    {
      connectionName: "rail",
      rootConnectionName: "POWER",
      traceThickness: 0.1,
      viaDiameter: 0.45,
      vias: [],
      route: [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 2, z: 0 },
        { x: 2, y: 2, z: 0 },
        { x: 4, y: 2, z: 0 },
        { x: 4, y: 0, z: 0 },
      ],
    },
  ]
  const branch: HighDensityRoute = {
    connectionName: "branch",
    rootConnectionName: "POWER",
    traceThickness: 0.1,
    viaDiameter: 0.45,
    vias: [],
    route: [
      { x: 2, y: 2, z: 0 },
      { x: 2, y: 3, z: 0 },
    ],
  }
  const convert = (routes: HighDensityRoute[]): SimplifiedPcbTraces =>
    routes.map((route) => ({
      type: "pcb_trace",
      pcb_trace_id: route.connectionName,
      connection_name: route.connectionName,
      rootConnectionName: "POWER",
      route: route.route.map((point) => ({
        route_type: "wire",
        x: point.x,
        y: point.y,
        layer: "top",
        width: 0.1,
      })),
    }))
  const connMap = getConnectivityMapFromSimpleRouteJson(srj)
  connMap.addConnections([["rail", "branch", "POWER"]])
  const guard = new PhysicalConnectivityInvariant(
    srj,
    convert([...routes, branch]),
  )
  let rejected = 0
  const solver = new Pipeline9PlanarShortcutSolver({
    srj,
    routes,
    otherRoutes: [branch],
    connMap,
    effort: 5,
    viaHoleDiameter: 0.2,
    isValid: (candidate) => {
      const result = guard.validate(convert([...candidate, branch]))
      expect(result.validationError).toBeUndefined()
      if (!result.safe) rejected++
      return result.safe
    },
  })
  solver.solve()
  expect(rejected).toBeGreaterThan(0)
  expect(solver.getOutput()).toEqual(routes)
  expect(solver.stats.accepted).toBe(0)
})
