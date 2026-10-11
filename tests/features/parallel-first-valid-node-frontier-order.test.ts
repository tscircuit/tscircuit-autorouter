import { expect, test } from "bun:test"
import { Pipeline9ParallelHighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9ParallelHighDensitySolver"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import type { FirstValidA13NodeResult } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelHighDensityFrontierTypes"
import type { Pipeline9ParallelHighDensityNodeResult } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelWorkerTypes"
import { createFirstValidFrontierFixture } from "tests/fixtures/first-valid-frontier-fixture"
import { FirstValidFrontierControlledPool } from "tests/fixtures/first-valid-frontier-controlled-pool"

test("whole-node HD frontier selects earliest valid A13 or native output while preserving serial node commits", async (): Promise<void> => {
  const { params, nodes, routes } = createFirstValidFrontierFixture()
  const pool = new FirstValidFrontierControlledPool({ workerCount: 4 })
  const solver = new Pipeline9ParallelHighDensitySolver({ ...params, workerPool: pool, highDensityPolicy: "first-valid" })
  const policy = { eligiblePortfolioCount: 0, acceptedCandidateCount: 0, rejectedCandidateCount: 0,
    rejectionReasons: {}, winners: [] }
  const nodeStats = nodes.map((node) => ({ ...new Pipeline9HighDensitySolver({ ...params, nodePortPoints: [node] }).stats,
    regularNodeCount: 1, solvedNodeCount: 1 }))
  solver.step()
  expect(pool.tasks.map(({ job }) => job.kind)).toEqual(["highDensityNode", "highDensityA13Node", "highDensityNode", "highDensityA13Node"])
  for (const task of [pool.tasks[0]!, pool.tasks[2]!]) {
    if (task.job.kind !== "highDensityNode") throw new Error("Expected generic job")
    expect(task.job.disableIdleA13Candidate).toBe(true)
  }
  pool.tasks[1]!.resolve({ kind: "highDensityA13Node", status: "solved", routes: routes[0]!,
    nodeStats: nodeStats[0]!, firstValidStats: policy,
    work: { iterations: 3, maxIterations: 50_000_000, routingIterations: 30, sourceStats: {} } } satisfies FirstValidA13NodeResult)
  await Promise.resolve()
  expect(solver.routes).toEqual([])
  const genericFirst: Pipeline9ParallelHighDensityNodeResult = { status: "solved", routes: routes[1]!,
    nodeStats: nodeStats[1]!, nodeIterations: 4, firstValidStats: policy }
  pool.tasks[2]!.resolve(genericFirst)
  await Promise.resolve()
  while (!solver.solved && !solver.failed) {
    solver.step()
    if (solver.pendingEffects?.length) await Promise.all(solver.pendingEffects.map((effect) => effect.promise))
  }
  expect(solver.solved).toBe(true)
  expect(solver.routes.map((route) => route.connectionName)).toEqual([
    "connection_1_0", "connection_1_1", "connection_0_0", "connection_0_1",
  ])
  expect(solver.routes[0]!.rootConnectionName).toBe("root_1_0")
  expect(solver.routes[0]!.startPcbPortId).toBe("left_1_0")
  expect(solver.routes[0]!.endPcbPortId).toBe("right_1_0")
  for (const taskIndex of [0, 3]) {
    const job = pool.tasks[taskIndex]!.job
    if ((job.kind !== "highDensityNode" && job.kind !== "highDensityA13Node") || !job.cancellationBuffer) throw new Error("Missing loser cancellation")
    expect(Atomics.load(new Int32Array(job.cancellationBuffer), 0)).toBe(1)
  }
  pool.tasks[0]!.resolve({ status: "cancelled", nodeStats: nodeStats[0]!, nodeIterations: 2, firstValidStats: policy } satisfies Pipeline9ParallelHighDensityNodeResult)
  pool.tasks[3]!.resolve({ kind: "highDensityA13Node", status: "cancelled",
    work: { iterations: 1, maxIterations: 50_000_000, routingIterations: 10, sourceStats: {} } } satisfies FirstValidA13NodeResult)
  await Promise.resolve()
  expect(solver.stats.firstValidNodeFrontierStats.pairedNodeCount).toBe(2)
  expect(solver.stats.firstValidNodeFrontierStats.loserCancellationSignals).toBe(2)
  expect(solver.stats.firstValidNodeFrontierStats.winners.map((winner: { source: string }) => winner.source)).toEqual(["validated-a13", "generic-native"])
  expect(solver.stats.firstValidNodeFrontierStats.candidateWork).toHaveLength(4)
  expect(solver.stats.regularNodeCount).toBe(2)
  pool.dispose()
})
