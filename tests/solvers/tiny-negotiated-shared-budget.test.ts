import { expect, test } from "bun:test"
import { Pipeline9LocalWorkerPool } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9LocalWorkerPool"
import { TinyIndexedSelectiveReripHyperGraphSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/TinyIndexedSelectiveReripHyperGraphSolver"
import { createNegotiatedOccupancySnapshot, type NegotiatedPathingRouteJob, type NegotiatedPathingRouteResult } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelNegotiatedPathingTypes"
import { negotiatedPathingFixture } from "../fixtures/negotiated-pathing-fixture"

test("four negotiated workers share one strict budget and seed each slot's graph independently", async (): Promise<void> => {
  const { topology, problem } = negotiatedPathingFixture()
  const coordinator = new TinyIndexedSelectiveReripHyperGraphSolver(topology, problem)
  const snapshot = createNegotiatedOccupancySnapshot(coordinator)
  const expansionTickets = new Int32Array(new SharedArrayBuffer(4))
  const job: NegotiatedPathingRouteJob = { kind: "pathingNegotiatedRoute", graphId: 910,
    graph: { topology, problem }, snapshot, routeId: 0, mode: "cost-aware",
    options: { MAX_ITERATIONS: 1000 }, expansionTickets }
  const pool = new Pipeline9LocalWorkerPool({ workerCount: 4 })
  try {
    expansionTickets[0] = 1000
    const first = await pool.run<NegotiatedPathingRouteResult>(job)
    expect(first.status).toBe("solved")
    for (const graphId of [910, 911]) {
      expansionTickets[0] = 1000
      const results = await Promise.all(Array.from({ length: 4 }, (_, index) =>
        pool.run<NegotiatedPathingRouteResult>({ ...job, graphId, routeId: index % 2 })))
      for (const result of results) expect(result.status).toBe("solved")
      expect(results.reduce((sum, result) => sum + result.expansions, 0) + expansionTickets[0]!).toBe(1000)
    }
    expansionTickets[0] = 7
    const limited = await Promise.all(Array.from({ length: 4 }, () => pool.run<NegotiatedPathingRouteResult>({ ...job, graphId: 911 })))
    expect(limited.reduce((sum, result) => sum + result.expansions, 0) + expansionTickets[0]!).toBe(7)
    expect(limited.some((result) => result.status === "budget")).toBe(true)
    expect(pool.stats.maxActiveWorkers).toBe(4)
  } finally { pool.dispose() }
})
