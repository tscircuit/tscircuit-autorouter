import { expect, test } from "bun:test"
import { Pipeline9LocalWorkerPool } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9LocalWorkerPool"
import { Pipeline9ParallelHighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9ParallelHighDensitySolver"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { Pipeline9HighDensitySolver, type Pipeline9HighDensitySolverParams } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { getGlobalInMemoryCache } from "lib/cache/setupGlobalCaches"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("idle workers preserve physical portfolio and grow-shrink routing on the three SRJ18 hard nodes", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 16)
  getGlobalInMemoryCache().clearCache()
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(structuredClone(scenario), { effort: 1, cacheProvider: null })
  pipeline.solveUntilPhase("highDensityRouteSolver")
  const definition = pipeline.pipelineDef.find((step) => step.solverName === "highDensityRouteSolver")
  if (!definition) throw new Error("Expected the original high-density pipeline stage")
  const params = (definition.getConstructorParams(pipeline) as [Pipeline9HighDensitySolverParams])[0]
  expect(params.fixedHdRoutes).toHaveLength(0)
  const nodeIds = ["cmn_20", "cmn_193", "cmn_77"]
  const nodes = nodeIds.map((nodeId) => {
    const node = params.nodePortPoints.find((candidate) => candidate.capacityMeshNodeId === nodeId)
    if (!node) throw new Error(`Expected SRJ18 sample 16 hard node ${nodeId}`)
    return node
  })
  let historyJobsStarted = 0
  const pool = new Pipeline9LocalWorkerPool({
    workerCount: 4,
    workerFactory: (url: URL): Worker => {
      const worker = new Worker(url, { type: "module" })
      const postMessage = worker.postMessage.bind(worker)
      worker.postMessage = (message: unknown): void => {
        const request = message as { job?: { kind?: string } }
        if (request.job?.kind === "multiHeadHistory") historyJobsStarted++
        postMessage(message)
      }
      return worker
    },
  })
  try {
    await pool.warmup()
    for (const node of nodes) {
      const originalNode = structuredClone(node)
      getGlobalInMemoryCache().clearCache()
      const serial = new Pipeline9HighDensitySolver({ ...params, nodePortPoints: [structuredClone(node)] })
      serial.solve()
      expect(serial.solved, serial.error ?? "").toBe(true)
      const beforeHistoryJobs = historyJobsStarted
      const parallel = new Pipeline9ParallelHighDensitySolver({ ...params, nodePortPoints: [structuredClone(node)], workerPool: pool })
      while (!parallel.solved && !parallel.failed) {
        parallel.step()
        if (parallel.pendingEffects?.length) await Promise.all(parallel.pendingEffects.map((effect) => effect.promise))
      }
      expect(parallel.solved, parallel.error ?? "").toBe(true)
      expect(parallel.failed).toBe(false)
      expect(parallel.routes).toEqual(serial.routes)
      for (const [stat, value] of Object.entries(serial.stats)) {
        if (typeof value === "number") expect(parallel.stats[stat], stat).toBe(value)
      }
      expect(historyJobsStarted).toBeGreaterThan(beforeHistoryJobs)
      expect(node).toEqual(originalNode)
    }
    expect(pool.stats.maxActiveWorkers).toBeGreaterThan(1)
    expect(pool.stats.maxActiveWorkers).toBeLessThanOrEqual(4)
  } finally {
    pool.dispose()
  }
})
