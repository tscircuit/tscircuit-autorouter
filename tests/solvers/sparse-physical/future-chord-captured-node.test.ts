import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { doPipeline9RoutesHaveCopperConflict } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import { PriorityDagIntraNodeSolver } from "lib/solvers/HighDensitySolver/PriorityDagIntraNodeSolver"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost as Native } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"
import captured from "./capturedFutureChord.json"

test("cmn_314 realizes both physical routes instead of excluding vias on an imaginary future chord", (): void => {
  const solver = new PriorityDagIntraNodeSolver({
    nodeWithPortPoints: captured.node,
    connMap: new ConnectivityMap({
      connectivity_net51: ["source_trace_1__source_net_1_mst16"],
      connectivity_net49: ["source_trace_3__source_net_3_mst0"],
    }),
    viaDiameter: 0.3,
    viaHoleDiameter: 0.15,
    minViaHoleEdgeToViaHoleEdgeClearance: 0.1,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    layerCount: 2,
    priorityFamilySize: 6,
    sparsePhysicalSearch: true,
    captureSearchDebug: false,
  })
  const allowance = solver.MAX_ITERATIONS
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.solvedRoutes).toHaveLength(2)
  expect(solver.MAX_ITERATIONS).toBe(allowance)
  expect(solver.iterations).toBeLessThan(allowance)
  expect(doPipeline9RoutesHaveCopperConflict({
    left: solver.solvedRoutes[0],
    right: solver.solvedRoutes[1],
    clearance: 0.15,
    layerCount: 2,
  })).toBe(false)
  for (let task = 0; task < solver["tasks"].length; task++) {
    expect(solver.solvedRoutes[task].route[0]).toEqual(solver["tasks"][task].points[0])
    expect(solver.solvedRoutes[task].route.at(-1)).toEqual(solver["tasks"][task].points[1])
  }
  const state = solver["current"]!
  const options = solver["getOptions"](0, state)
  expect(options.futureConnections).toHaveLength(1)
  const oldPolicy = new Native(options)
  const site = solver.solvedRoutes[0].vias[0]
  expect(oldPolicy.isViaTooCloseToFutureConnectionTrace({
    ...site, z: 0, g: 0, h: 0, f: 0, parent: null,
  })).toBe(true)
})
