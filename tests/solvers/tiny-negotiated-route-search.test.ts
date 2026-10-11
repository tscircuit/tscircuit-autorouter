import { expect, test } from "bun:test"
import { TinyIndexedSelectiveReripHyperGraphSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/TinyIndexedSelectiveReripHyperGraphSolver"
import { executeNegotiatedPathingRouteJob } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/TinyNegotiatedRouteSearch"
import { createNegotiatedOccupancySnapshot, type NegotiatedPathingRouteJob } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelNegotiatedPathingTypes"
import { negotiatedPathingFixture } from "../fixtures/negotiated-pathing-fixture"

test("negotiated single-route search respects reservations, shared budgets and immutable occupancy", (): void => {
  const { topology, problem } = negotiatedPathingFixture()
  const coordinator = new TinyIndexedSelectiveReripHyperGraphSolver(topology, problem, { RIP_THRESHOLD_RAMP_ATTEMPTS: 0 })
  const snapshot = createNegotiatedOccupancySnapshot(coordinator)
  const initial = structuredClone(snapshot)
  const expansionTickets = new Int32Array(new SharedArrayBuffer(4))
  expansionTickets[0] = 1000
  const job: NegotiatedPathingRouteJob = { kind: "pathingNegotiatedRoute", graphId: 901,
    graph: { topology, problem }, snapshot, routeId: 0,
    mode: "cost-aware", options: { MAX_ITERATIONS: 1000 }, expansionTickets }
  const result = executeNegotiatedPathingRouteJob(job)
  expect(result.status).toBe("solved")
  if (result.status !== "solved") throw new Error("Expected route search to solve")
  expect(result.segments).toEqual([{ regionId: 0, fromPortId: 0, toPortId: 1 },
    { regionId: 1, fromPortId: 1, toPortId: 2 }])
  expect(snapshot).toEqual(initial)
  expect(result.expansions + expansionTickets[0]!).toBe(1000)
  expect(coordinator.state.portAssignment).toEqual(new Int32Array(6).fill(-1))
  expansionTickets[0] = 1
  const limited = executeNegotiatedPathingRouteJob({ ...job, graph: undefined })
  expect(limited.status).toBe("budget")
  expect(limited.expansions).toBe(1)
  expect(expansionTickets[0]).toBe(0)
  expansionTickets[0] = 0
  expect(executeNegotiatedPathingRouteJob(job).expansions).toBe(0)
  expect(() => executeNegotiatedPathingRouteJob({ ...job, graphId: 999, graph: undefined })).toThrow("missing graph")
  expect(() => executeNegotiatedPathingRouteJob({ ...job, routeId: 999 })).toThrow("invalid route")
})
