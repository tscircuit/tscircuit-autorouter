import { expect, test } from "bun:test"
import { Pipeline9ParallelHighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9ParallelHighDensitySolver"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import type { FirstValidA13NodeResult } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelHighDensityFrontierTypes"
import type { Pipeline9ParallelHighDensityNodeResult } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelWorkerTypes"
import { createFirstValidFrontierFixture } from "tests/fixtures/first-valid-frontier-fixture"
import { FirstValidFrontierControlledPool } from "tests/fixtures/first-valid-frontier-controlled-pool"

test("HD frontier distinguishes rejected candidates, native failures and consumed exceptions", async (): Promise<void> => {
  for (const mode of ["rejected", "native-failed", "both-failed", "a13-exception", "native-exception", "unused-exception", "native-typed-exception", "unused-native-exception"] as const) {
    const { params, nodes, routes } = createFirstValidFrontierFixture(1)
    const pool = new FirstValidFrontierControlledPool({ workerCount: 4 })
    const solver = new Pipeline9ParallelHighDensitySolver({ ...params, workerPool: pool, highDensityPolicy: "first-valid" })
    const policy = { eligiblePortfolioCount: 0, acceptedCandidateCount: 0, rejectedCandidateCount: 0,
      rejectionReasons: {}, winners: [] }
    const nodeStats = { ...new Pipeline9HighDensitySolver({ ...params, nodePortPoints: [nodes[0]!] }).stats,
      regularNodeCount: 1, solvedNodeCount: 1 }
    const genericSolved: Pipeline9ParallelHighDensityNodeResult = { status: "solved", routes: routes[0]!,
      nodeStats, firstValidStats: policy }
    const genericFailed: Pipeline9ParallelHighDensityNodeResult = { status: "failed", error: "original generic failure",
      nodeStats, firstValidStats: policy }
    const work = { iterations: 2, maxIterations: 50_000_000, routingIterations: 10, sourceStats: {} }
    solver.step()
    if (mode === "rejected") {
      pool.tasks[1]!.resolve({ kind: "highDensityA13Node", status: "rejected", reason: "trace-width", work } satisfies FirstValidA13NodeResult)
      await Promise.resolve()
      expect(solver.solved).toBe(false)
      expect(solver.failed).toBe(false)
      pool.tasks[0]!.resolve(genericSolved)
    } else if (mode === "native-failed" || mode === "both-failed") {
      pool.tasks[0]!.resolve(genericFailed)
      await Promise.resolve()
      expect(solver.failed).toBe(false)
      pool.tasks[1]!.resolve(mode === "native-failed"
        ? { kind: "highDensityA13Node", status: "solved", routes: routes[0]!, nodeStats, firstValidStats: policy, work }
        : { kind: "highDensityA13Node", status: "failed", error: "original A13 failure", work })
    } else if (mode === "a13-exception") {
      pool.tasks[1]!.resolve({ kind: "highDensityA13Node", status: "exception",
        exception: { name: "RangeError", message: "A13 invariant" }, work } satisfies FirstValidA13NodeResult)
    } else if (mode === "native-exception") {
      pool.tasks[0]!.reject(new RangeError("Generic invariant"))
    } else if (mode === "native-typed-exception") {
      pool.tasks[0]!.resolve({ status: "exception", exception: { name: "RangeError", message: "Generic invariant" },
        nodeStats, nodeIterations: 7, firstValidStats: policy } satisfies Pipeline9ParallelHighDensityNodeResult)
    } else if (mode === "unused-native-exception") {
      pool.tasks[1]!.resolve({ kind: "highDensityA13Node", status: "solved", routes: routes[0]!,
        nodeStats, firstValidStats: policy, work } satisfies FirstValidA13NodeResult)
      await Promise.resolve()
      pool.tasks[0]!.resolve({ status: "exception", exception: { name: "RangeError", message: "unused generic invariant" },
        nodeStats, nodeIterations: 7, firstValidStats: policy } satisfies Pipeline9ParallelHighDensityNodeResult)
    } else {
      pool.tasks[0]!.resolve(genericSolved)
      await Promise.resolve()
      pool.tasks[1]!.resolve({ kind: "highDensityA13Node", status: "exception",
        exception: { name: "RangeError", message: "unused speculative invariant" }, work } satisfies FirstValidA13NodeResult)
    }
    if (solver.pendingEffects?.length) await Promise.all(solver.pendingEffects.map((effect) => effect.promise))
    await Promise.resolve()
    if (mode === "a13-exception" || mode === "native-exception" || mode === "native-typed-exception") {
      expect(() => solver.step()).toThrow(mode === "a13-exception" ? "A13 invariant" : "Generic invariant")
      expect(solver.failed).toBe(true)
      expect(solver.solved).toBe(false)
    } else {
      while (!solver.solved && !solver.failed) solver.step()
      if (mode === "both-failed") {
        expect(solver.failed).toBe(true)
        expect(solver.error).toBe("original generic failure")
      } else {
        expect(solver.solved).toBe(true)
        expect(solver.failed).toBe(false)
        expect(solver.routes).toHaveLength(2)
      }
    }
    if (mode === "rejected") expect(solver.stats.firstValidNodeFrontierStats.rejectionReasons["trace-width"]).toBe(1)
    if (mode === "unused-exception") expect(solver.stats.firstValidNodeFrontierStats.candidateWork.at(-1)?.sourceStats.exception.message).toBe("unused speculative invariant")
    if (mode === "unused-native-exception") {
      expect(solver.stats.firstValidNodeFrontierStats.candidateWork.at(-1)?.sourceStats.exception.message).toBe("unused generic invariant")
      expect(solver.stats.firstValidNodeFrontierStats.candidateWork.at(-1)?.iterations).toBe(7)
    }
    pool.dispose()
  }
})
