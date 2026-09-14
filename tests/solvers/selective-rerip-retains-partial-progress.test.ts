import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { loadSerializedHyperGraph } from "tiny-hypergraph/lib/compat/loadSerializedHyperGraph"
import { SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments"

test("final routing preserves committed progress from before a global reset and still completes every connection", () => {
  const graph: SerializedHyperGraph = {
    regions: [],
    ports: [],
    connections: [],
  }
  for (const route of [0, 1]) {
    for (const region of [0, 1, 2]) {
      graph.regions.push({
        regionId: `region_${route}_${region}`,
        pointIds:
          region === 0
            ? [`port_${route}_0`]
            : region === 2
              ? [`port_${route}_1`]
              : [`port_${route}_0`, `port_${route}_1`],
        d: {
          center: { x: region - 0.5, y: route * 2 },
          width: 1,
          height: 1,
          availableZ: [0],
        },
      })
    }
    for (const port of [0, 1]) {
      graph.ports.push({
        portId: `port_${route}_${port}`,
        region1Id: `region_${route}_${port}`,
        region2Id: `region_${route}_${port + 1}`,
        d: { x: port, y: route * 2, z: 0 },
      })
    }
    graph.connections!.push({
      connectionId: `connection_${route}`,
      mutuallyConnectedNetworkId: `net_${route}`,
      startRegionId: `region_${route}_0`,
      endRegionId: `region_${route}_2`,
    })
  }
  const { topology, problem } = loadSerializedHyperGraph(graph)
  const solver =
    new SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments(
      topology,
      problem,
      { ACCEPT_BEST_SOLUTION_ON_TIMEOUT: true, GREEDY_FINAL_ROUTE_ITERS: 1 },
    )
  while (
    !solver.failed &&
    !solver.solved &&
    (solver.state.unroutedRoutes.length > 1 ||
      solver.state.currentRouteId !== undefined)
  )
    solver.step()
  expect(solver.failed).toBe(false)
  expect(solver.state.unroutedRoutes).toHaveLength(1)
  solver.resetRoutingStateForRerip()
  expect(solver.state.unroutedRoutes).toHaveLength(2)
  solver.tryFinalAcceptance()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.state.unroutedRoutes).toHaveLength(0)
  expect(solver.getOutput().solvedRoutes).toHaveLength(2)
  expect(solver.stats.greedyFinalRouteRestoredPartialState).toBe(true)
  expect(solver.stats.greedyFinalRoutePreviousRemainingRouteCount).toBe(2)
  expect(solver.stats.greedyFinalRouteRemainingRouteCount).toBe(1)
})
