import { expect, test } from "bun:test"
import { MultiSimplifiedPathSolver } from "@tscircuit/trace-simplification-solver"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { ParallelMultiSimplifiedPathSolver } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelMultiSimplifiedPathSolver"
import { ParallelPathWaveExecutor } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/executeParallelPathWave"
import type { ParallelPathWaveJob, ParallelPathWaveResult, ParallelStageWorkerPool, ParallelStageWorkerJob } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelStageWorkerTypes"
import type { HighDensityRoute } from "../../lib/types/high-density-types"

type Corrupt = (result: ParallelPathWaveResult) => void
class WavePool implements ParallelStageWorkerPool {
  private readonly executor = new ParallelPathWaveExecutor()
  readonly jobs: ParallelPathWaveJob[] = []
  constructor(private readonly corrupt?: Corrupt) {}
  async run<T>(job: ParallelStageWorkerJob): Promise<T> {
    if (job.kind !== "simplifyPathWave") throw new Error("Unexpected test job")
    this.jobs.push(structuredClone(job))
    const result = this.executor.execute(structuredClone(job))
    this.corrupt?.(result)
    return result as T
  }
}

function independentRoutes(): HighDensityRoute[] {
  const routes = Array.from({ length: 24 }, (_, index): HighDensityRoute => ({
    connectionName: `n${index}`, traceThickness: .1, viaDiameter: .3, vias: [],
    route: [{x:index * 4,y:0,z:0},{x:index * 4 + .4,y:.3,z:0},{x:index * 4 + .8,y:0,z:0}],
  }))
  routes.push({ connectionName: "successor", traceThickness: .1, viaDiameter: .3, vias: [],
    route: [{x:0,y:.2,z:0},{x:46,y:2,z:0},{x:93,y:.2,z:0}] })
  return routes
}

test("ready batch commits all rows before successor release and rejects malformed rows without publishing routes", async (): Promise<void> => {
  const config = { unsimplifiedHdRoutes: independentRoutes(), obstacles: [], connMap: new ConnectivityMap({}) }
  const native = new MultiSimplifiedPathSolver(config)
  native.solve()
  const pool = new WavePool()
  const parallel = new ParallelMultiSimplifiedPathSolver({ ...config, workerPool: pool, workerCount: 4 })
  await parallel.solveAsync()
  expect(parallel.simplifiedHdRoutes).toEqual(native.simplifiedHdRoutes)
  expect(parallel.stats.nativePathSteps).toBe(native.iterations)
  const successor = pool.jobs.find((job) => job.indexes.includes(24))!
  expect(successor).toBeDefined()
  expect(successor.indexes).toEqual([24])
  expect(successor.updates.map((update) => update.index)).toEqual(Array.from({length:24},(_, index) => index))
  expect(pool.jobs.length).toBeLessThan(config.unsimplifiedHdRoutes.length)
  expect(pool.jobs.some((job) => job.indexes.length > 1)).toBe(true)
  const atomicConfig = { ...config, unsimplifiedHdRoutes: [
    ...config.unsimplifiedHdRoutes.slice(0, 24),
    { connectionName: "first-parent-successor", traceThickness: .1, viaDiameter: .3, vias: [],
      route: [{x:.1,y:.2,z:0},{x:.4,y:.4,z:0},{x:.7,y:.2,z:0}] },
  ] }
  for (const corrupt of [
    (result: ParallelPathWaveResult): void => { result.results.pop() },
    (result: ParallelPathWaveResult): void => { result.results[1]!.index = -1 },
    (result: ParallelPathWaveResult): void => { result.results[1]!.nativeSteps = 0 },
    (result: ParallelPathWaveResult): void => { result.contextId++ },
  ]) {
    // Only the batch containing predecessor0 is malformed. The other active
    // batches can complete before the rejection handler runs, so publishing its
    // valid first row would incorrectly let them dispatch this successor.
    const malformedPool = new WavePool((result): void => {
      if (result.results[0]!.index === 0) corrupt(result)
    })
    const malformed = new ParallelMultiSimplifiedPathSolver({ ...atomicConfig, workerPool: malformedPool, workerCount: 4 })
    expect(malformed.dependencies.predecessors[24]).toEqual([0])
    await expect(malformed.solveAsync()).rejects.toThrow("Invalid path simplification result")
    expect(malformed.failed).toBe(true)
    expect(malformed.solved).toBe(false)
    expect(malformed.simplifiedHdRoutes).toEqual([])
    expect(malformed.currentUnsimplifiedHdRouteIndex).toBe(0)
    expect(malformedPool.jobs.some((job) => job.indexes.includes(24))).toBe(false)
  }
})
