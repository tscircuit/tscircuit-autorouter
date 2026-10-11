import { expect, test } from "bun:test"
import { Pipeline9LocalWorkerPool } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9LocalWorkerPool"
import type { FirstValidA13NodeResult } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelHighDensityFrontierTypes"
import type { Pipeline9ParallelHighDensityContext, Pipeline9ParallelHighDensityNodeResult } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelWorkerTypes"
import { createFirstValidNode } from "tests/fixtures/first-valid-hd-fixtures"

test("a real worker encodes an unused generic algorithm exception without terminating unrelated pool work", async (): Promise<void> => {
  const pool = new Pipeline9LocalWorkerPool({ workerCount: 4,
    workerUrl: new URL("../fixtures/first-valid-exception-worker.ts", import.meta.url) })
  const cancellation = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT))
  const barrier = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT))
  const context: Pipeline9ParallelHighDensityContext = { connectivityNetMap: { signal_root: ["signal", "signal_root"] },
    connectivityIdToNetMap: { signal: "signal_root", signal_root: "signal_root" }, colorMap: {}, obstacles: [],
    viaDiameter: 0.3, traceWidth: 0.15, obstacleMargin: 0.15, effort: 0.1, layerCount: 2,
    allowBlindAndBuriedVias: false, preserveTerminalPcbPortIds: true, includeBoardObstacles: true,
    enableRegionalFallback: false, highDensityPolicy: "first-valid", firstValidClearance: 0.1 }
  const node = { ...createFirstValidNode(), capacityMeshNodeId: "late-generic-exception" }
  const unrelatedNode = { ...createFirstValidNode(), capacityMeshNodeId: "unrelated-owner",
    testBarrier: barrier.buffer as SharedArrayBuffer }
  try {
    await pool.warmup()
    const contextId = pool.createContextId()
    const generic = pool.run<Pipeline9ParallelHighDensityNodeResult>({ kind: "highDensityNode", contextId, context,
      nodeWithPortPoints: node, nodePf: null, disableIdleA13Candidate: true,
      cancellationBuffer: cancellation.buffer as SharedArrayBuffer }).then(
      (result) => ({ ok: true as const, result }), (error: unknown) => ({ ok: false as const, error }))
    const unrelated = pool.run<Pipeline9ParallelHighDensityNodeResult>({ kind: "highDensityNode", contextId, context,
      nodeWithPortPoints: unrelatedNode, nodePf: null, disableIdleA13Candidate: true }).then(
      (result) => ({ ok: true as const, result }), (error: unknown) => ({ ok: false as const, error }))
    const winner = await pool.run<FirstValidA13NodeResult>({ kind: "highDensityA13Node", contextId, context,
      nodeWithPortPoints: node, nodePf: null, cancellationBuffer: new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT) })
    expect(winner.status).toBe("solved")
    Atomics.store(cancellation, 0, 1)
    const genericOutcome = await generic
    expect(genericOutcome.ok).toBe(true)
    if (!genericOutcome.ok) throw genericOutcome.error
    const unused = genericOutcome.result
    expect(unused.status).toBe("exception")
    if (unused.status !== "exception") throw new Error("Expected the controlled generic exception")
    expect(unused.exception).toMatchObject({ name: "RangeError", message: "late cancelled generic algorithm failure" })
    expect(unused.nodeIterations).toBe(0)
    await pool.warmup()
    Atomics.store(barrier, 0, 1)
    const other = await unrelated
    expect(other.ok).toBe(true)
    if (!other.ok) throw other.error
    expect(other.result.status).toBe("solved")
    expect(pool.stats.maxActiveWorkers).toBeLessThanOrEqual(4)
  } finally {
    Atomics.store(cancellation, 0, 1)
    Atomics.store(barrier, 0, 1)
    pool.dispose()
  }
})
