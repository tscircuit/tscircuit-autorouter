import { expect, test } from "bun:test"
import { initializeReferenceDrcRuntime } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/initializeReferenceDrcRuntime"
import { MultiSimplifiedPathSolver, SingleSimplifiedPathSolver5 } from "@tscircuit/trace-simplification-solver"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { ObservedMultiSimplifiedPathSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ObservedMultiSimplifiedPathSolver"
import { assertParallelPathLookaheadJob, assertParallelPathLookaheadResult, ParallelPathLookaheadExecutor } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelPathLookaheadExecutor"
import type { ParallelPathLookaheadJob } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelPathLookaheadTypes"
import type { ParallelPathWaveContext } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelStageWorkerTypes"
import type { HighDensityRoute } from "lib/types/high-density-types"

type GeometryIndex = NonNullable<ConstructorParameters<typeof SingleSimplifiedPathSolver5>[0]["geometryQuery"]>["index"]

function makeContext(): ParallelPathWaveContext {
  const routes: HighDensityRoute[] = []
  for (let index = 0; index < 6; index++) routes.push({ connectionName: `route-${index}`,
    traceThickness: 0.15, viaDiameter: 0.3, vias: index % 3 === 0 ? [{ x: 0.1, y: index / 2 + 0.3 }] : [],
    route: [{ x: -2, y: index / 2, z: index % 2 }, { x: -1, y: index / 2 + 0.5, z: index % 2 },
      { x: 1, y: index / 2 + 0.5, z: index % 2 }, { x: 2, y: index / 2, z: index % 2 }] })
  return { params: { unsimplifiedHdRoutes: routes, obstacles: [] }, connectivityNetMap: {}, connectivityIdToNetMap: {} }
}

function makeJob(context: ParallelPathWaveContext, index: number, committedPrefix = 0): ParallelPathLookaheadJob {
  return { kind: "simplifyPathLookahead", contextId: 17, context, index, committedPrefix, updates: [],
    cancellationBuffer: new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT), nativePhaseStepLimit: 100_000_000 }
}

function nativeRoute(context: ParallelPathWaveContext, index: number, prefix: HighDensityRoute[]): { route: HighDensityRoute; nativeSteps: number } {
  const native = new MultiSimplifiedPathSolver({ ...context.params, connMap: new ConnectivityMap({}) })
  const geometryIndex = (native as unknown as { geometryIndex: GeometryIndex }).geometryIndex
  for (let peer = 0; peer < prefix.length; peer++) geometryIndex.replaceRoute(peer, prefix[peer]!)
  native.currentUnsimplifiedHdRouteIndex = index
  native.simplifiedHdRoutes = native.unsimplifiedHdRoutes.slice(0, index).map((route, peer) => prefix[peer] ?? route)
  native.step()
  while (native.activeSubSolver && !native.failed) native.step()
  if (native.failed) throw new Error(`Native route failed: ${native.error}`)
  return { route: native.simplifiedHdRoutes[index]!, nativeSteps: native.iterations }
}

test("lookahead workspaces restore all future copper, defer native errors, and reject malformed footprints", async (): Promise<void> => {
  await initializeReferenceDrcRuntime()
  const context = makeContext()
  const snapshot = structuredClone(context)
  const executor = new ParallelPathLookaheadExecutor()
  const firstJob = makeJob(context, 4)
  const first = executor.execute(firstJob)
  assertParallelPathLookaheadResult(first, firstJob)
  expect(first.status).toBe("prepared")
  if (first.status !== "prepared") throw new Error("Missing prepared route")
  expect(first.route).toEqual(nativeRoute(context, 4, []).route)
  expect(first.nativeSteps).toBe(nativeRoute(context, 4, []).nativeSteps)
  expect(first.nativeQueryCount).toBe(first.footprint.queries.length)
  const earlierJob = { ...makeJob(context, 3), context: undefined }
  const earlier = executor.execute(earlierJob)
  assertParallelPathLookaheadResult(earlier, earlierJob)
  expect(earlier.status).toBe("prepared")
  if (earlier.status !== "prepared") throw new Error("Missing earlier prepared route")
  expect(earlier.route).toEqual(nativeRoute(context, 3, []).route)
  expect(earlier.nativeSteps).toBe(nativeRoute(context, 3, []).nativeSteps)
  const prefix = [nativeRoute(context, 0, []).route]
  const committedJob = { ...makeJob(context, 2, 1), context: undefined, updates: [{ index: 0, route: prefix[0]! }] }
  const committed = executor.execute(committedJob)
  assertParallelPathLookaheadResult(committed, committedJob)
  expect(committed.status).toBe("prepared")
  if (committed.status !== "prepared") throw new Error("Missing committed-context result")
  expect(committed.route).toEqual(nativeRoute(context, 2, prefix).route)
  expect(committed.nativeSteps).toBe(nativeRoute(context, 2, prefix).nativeSteps)
  const reusedJob = { ...makeJob(context, 1, 1), context: undefined }
  const reused = executor.execute(reusedJob)
  assertParallelPathLookaheadResult(reused, reusedJob)
  expect(reused.status).toBe("prepared")
  if (reused.status !== "prepared") throw new Error("Missing reused result")
  expect(reused.route).toEqual(nativeRoute(context, 1, prefix).route)
  expect(context).toEqual(snapshot)

  const cancellationJob = { ...makeJob(context, 5), context: undefined }
  Atomics.store(new Int32Array(cancellationJob.cancellationBuffer), 0, 1)
  const cancelled = executor.execute(cancellationJob)
  assertParallelPathLookaheadResult(cancelled, cancellationJob)
  expect(cancelled.status).toBe("cancelled")
  expect(cancelled.nativeSteps).toBe(0)
  const cappedJob = { ...makeJob(context, 5), context: undefined, nativePhaseStepLimit: 0 }
  const capped = executor.execute(cappedJob)
  assertParallelPathLookaheadResult(capped, cappedJob)
  expect(capped.status).toBe("algorithmError")
  expect(capped.nativeSteps).toBe(1)
  if (capped.status !== "algorithmError") throw new Error("Missing native cap failure")
  expect(capped.error).toContain("MAX_ITERATIONS=0")
  const afterFailureJob = { ...makeJob(context, 0), context: undefined }
  const afterFailure = executor.execute(afterFailureJob)
  expect(afterFailure.status).toBe("prepared")
  if (afterFailure.status !== "prepared") throw new Error("Missing post-failure result")
  expect(afterFailure.route).toEqual(prefix[0])

  const nativeStep = ObservedMultiSimplifiedPathSolver.prototype._step
  try {
    ObservedMultiSimplifiedPathSolver.prototype._step = function (): void { throw new RangeError("native path fault") }
    const exception = executor.execute(afterFailureJob)
    assertParallelPathLookaheadResult(exception, afterFailureJob)
    expect(exception.status).toBe("algorithmError")
    expect(exception.nativeSteps).toBe(1)
    if (exception.status !== "algorithmError") throw new Error("Missing deferred exception")
    expect(exception.error).toBe("MultiSimplifiedPathSolver error: RangeError: native path fault")
  } finally {
    ObservedMultiSimplifiedPathSolver.prototype._step = nativeStep
  }
  const malformedJobs: unknown[] = [null, { ...firstJob, index: -1 }, { ...firstJob, index: 1.5 },
    { ...firstJob, committedPrefix: 5 }, { ...firstJob, nativePhaseStepLimit: -1 },
    { ...firstJob, cancellationBuffer: new ArrayBuffer(4) }, { ...firstJob, cancellationBuffer: new SharedArrayBuffer(8) },
    { ...firstJob, updates: [{ index: 0, route: prefix[0] }] },
    { ...firstJob, committedPrefix: 2, updates: [{ index: 1, route: prefix[0] }, { index: 0, route: prefix[0] }] }]
  for (const job of malformedJobs) expect(() => assertParallelPathLookaheadJob(job)).toThrow()
  expect(() => executor.execute({ ...firstJob, context: undefined, contextId: 99 })).toThrow("Missing lookahead context")
  expect(() => new ParallelPathLookaheadExecutor().execute({ ...firstJob, index: 99 })).toThrow("exceeds its context")
  expect(() => new ParallelPathLookaheadExecutor().execute({ ...firstJob, committedPrefix: 1 })).toThrow("Missing lookahead committed route")
  expect(() => new ParallelPathLookaheadExecutor().execute({ ...firstJob, context: { ...context,
    params: { ...context.params, useTraceWidthAwareClearance: true } } })).toThrow("default native path policy")
  const query = first.footprint.queries[0]!
  expect(query).toBeDefined()
  const malformedResults: unknown[] = [null, { ...first, status: false }, { ...first, contextId: 99 },
    { ...first, nativeSteps: -1 }, { ...first, nativeSteps: Number.NaN }, { ...first, committedPrefix: 2 },
    { ...first, footprint: { ...first.footprint, complete: null } },
    { ...first, footprint: { ...first.footprint, queries: [{ ...query, valid: true, immutableObstacleFailure: true }] } },
    { ...first, footprint: { ...first.footprint, queries: [{ ...query, start: null }] } },
    { ...capped, error: false }, { ...capped, error: "" }]
  for (const result of malformedResults) expect(() => assertParallelPathLookaheadResult(result, firstJob)).toThrow()
  expect(() => executor.execute({ ...firstJob, context: { ...context, params: {
    ...context.params, unsimplifiedHdRoutes: [] } } })).toThrow("exceeds its context")
})
