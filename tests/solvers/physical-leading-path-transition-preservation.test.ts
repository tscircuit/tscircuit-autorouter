import { expect, test } from "bun:test"
import { MultiSimplifiedPathSolver } from "@tscircuit/trace-simplification-solver"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { preserveLeadingPathLayerTransitions } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/preserveLeadingPathLayerTransitions"
import { ParallelMultiSimplifiedPathSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelMultiSimplifiedPathSolver"
import { executeParallelStageJob } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelStageWorkerJobs"
import type { ParallelStageWorkerJob, ParallelStageWorkerPool } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelStageWorkerTypes"
import type { HighDensityRoute } from "lib/types/high-density-types"

function routeAt(x: number, layers: number[] = [0, 3]): HighDensityRoute {
  return { connectionName: `signal-${x}`, traceThickness: .1, viaDiameter: .3,
    startPcbPortId: `start-${x}`, endPcbPortId: `end-${x}`,
    route: [...layers.map((z) => ({ x, y: 0, z })), { x: x + 1, y: 0, z: layers.at(-1)! }],
    vias: [{ x, y: 0 }] }
}

function expectAnchors(input: HighDensityRoute, output: HighDensityRoute): void {
  expect(output.route.slice(0, input.route.length - 1)).toEqual(input.route.slice(0, -1))
  expect(output.vias).toContainEqual(input.vias[0]!)
  expect(output.route.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true)
  expect(output.startPcbPortId).toBe(input.startPcbPortId)
  expect(output.endPcbPortId).toBe(input.endPcbPortId)
  for (let index = 1; index < output.route.length; index++) {
    const a = output.route[index - 1]!, b = output.route[index]!
    if (a.z !== b.z) expect({ x: a.x, y: a.y }).toEqual({ x: b.x, y: b.y })
  }
}

test("physical path sampling retains exact leading via clusters before serial and worker route publication", async (): Promise<void> => {
  const nativeInput = routeAt(0)
  nativeInput.route = [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 3 },
    { x: .375, y: 0, z: 3 }, { x: 5, y: 0, z: 3 }, { x: 5, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: 3 }]
  nativeInput.vias = [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 1, y: 0 }]
  const params = { unsimplifiedHdRoutes: [nativeInput], obstacles: [],
    connMap: new ConnectivityMap({ signal: [nativeInput.connectionName] }),
    enableVertexShortcuts: true, useTraceWidthAwareClearance: true }
  const native = new MultiSimplifiedPathSolver(params)
  native.solve()
  expect(native.simplifiedHdRoutes[0]!.route[0]!.z).toBe(0)
  expect(native.simplifiedHdRoutes[0]!.route[1]!.z).toBe(3)
  expect(native.simplifiedHdRoutes[0]!.route[1]!.x).not.toBe(0)
  expect(native.simplifiedHdRoutes[0]!.vias).not.toContainEqual({ x: 0, y: 0 })
  for (const layers of [[0, 3], [0, 1, 3], [0, 0, 3], [3, 0]]) {
    const input = routeAt(0, layers)
    const original = structuredClone(input)
    const solver = new MultiSimplifiedPathSolver({ ...params, unsimplifiedHdRoutes: [input] })
    preserveLeadingPathLayerTransitions(solver)
    preserveLeadingPathLayerTransitions(solver)
    const budget = solver.MAX_ITERATIONS
    solver.solve()
    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    expect(solver.MAX_ITERATIONS).toBe(budget)
    expectAnchors(input, solver.simplifiedHdRoutes[0]!)
    expect(input).toEqual(original)
  }
  const inputs = [routeAt(0), routeAt(10)]
  const jobs: ParallelStageWorkerJob[] = []
  const pool: ParallelStageWorkerPool = { workerCount: 4, async run<T>(job: ParallelStageWorkerJob): Promise<T> {
    jobs.push(job)
    return executeParallelStageJob(job) as T
  } }
  const parallel = new ParallelMultiSimplifiedPathSolver({ ...params,
    unsimplifiedHdRoutes: inputs, workerPool: pool, workerCount: 4, preserveLeadingLayerTransitions: true })
  expect(parallel.batches.length).toBeGreaterThan(1)
  while (!parallel.solved && !parallel.failed) {
    parallel.step()
    await Promise.all(parallel.pendingEffects!.map((effect) => effect.promise))
  }
  expect(parallel.failed).toBe(false)
  expect(jobs).toHaveLength(2)
  for (const job of jobs) {
    expect(job.kind).toBe("simplifyPathWave")
    if (job.kind !== "simplifyPathWave") throw new Error("Unexpected worker kind")
    expect(job.context?.params.preserveLeadingLayerTransitions).toBe(true)
  }
  for (let index = 0; index < inputs.length; index++) expectAnchors(inputs[index]!, parallel.simplifiedHdRoutes[index]!)
  const started = new MultiSimplifiedPathSolver(params)
  started.step()
  expect(() => preserveLeadingPathLayerTransitions(started)).toThrow("before its phase starts")
  const missingVia = routeAt(0)
  missingVia.vias = []
  const invalid = new MultiSimplifiedPathSolver({ ...params, unsimplifiedHdRoutes: [missingVia] })
  preserveLeadingPathLayerTransitions(invalid)
  expect(() => invalid.solve()).toThrow("requires its leading via")
})
