import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { FindClearancePathSolver } from "@tscircuit/repair04"
import { preparePipeline9RepairConnectivity } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/preparePipeline9RepairConnectivity"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("repair keeps foreign copper blocked when a net ID is another net's alias", (): void => {
  const connMap = new ConnectivityMap({
    connectivity_net0: ["a", "pad_a"],
    connectivity_net1: ["b", "connectivity_net0", "pad_b"],
  })
  const srj: SimpleRouteJson = {
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    layerCount: 1,
    minTraceWidth: 0.1,
    obstacles: [],
    connections: [],
  }
  const geometry = {
    traceThickness: 0.1,
    viaDiameter: 0.45,
    route: [
      { x: -1, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
    ],
    vias: [],
  }
  const routes: HighDensityRoute[] = [
    {
      ...geometry,
      connectionName: "retained_a",
      rootConnectionName: "connectivity_net0",
    },
    { ...geometry, connectionName: "b", rootConnectionName: "b" },
  ]
  const prepared = preparePipeline9RepairConnectivity({ srj, routes, connMap })
  expect(prepared.routes.map((route) => route.rootConnectionName)).toEqual([
    "a",
    "b",
  ])
  expect(routes[0]!.rootConnectionName).toBe("connectivity_net0")
  const solver = new FindClearancePathSolver({
    ...prepared,
    srj: { ...prepared.srj, traces: undefined },
    routeIndex: 1,
    start: geometry.route[0]!,
    end: geometry.route[1]!,
    bounds: srj.bounds,
    traceThickness: 0.1,
    traceClearance: 0.1,
    viaClearance: 0.1,
    allowLayerChanges: false,
    maxNodes: 1000,
  })
  solver.solve()
  expect(solver.getOutput()).toBeNull()
  expect(solver.stats.nodesPopped).toBe(0)
})
