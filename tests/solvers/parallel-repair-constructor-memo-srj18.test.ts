import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { ParallelHighDensityRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelHighDensityRepairSolver"
import { createNativeRepairConnectivityMemoFactory } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/createNativeRepairConnectivityMemoFactory"
import { initializeReferenceDrcRuntime } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/initializeReferenceDrcRuntime"
import type { Pipeline4HighDensityRepairSolver } from "lib/solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSolver"
import type { SimpleRouteJson } from "lib/types"

test("constructor electrical memo preserves every native prepared repair sample on complete SRJ18 boards001 and005", async () => {
  await initializeReferenceDrcRuntime()
  const createMemo = createNativeRepairConnectivityMemoFactory(ParallelHighDensityRepairSolver.prototype)
  const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex")
  for (const sampleId of ["001", "005"]) {
    const srj = await Bun.file(new URL(`../../node_modules/dataset-srj18/samples/sample${sampleId}.json`, import.meta.url)).json() as SimpleRouteJson
    const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, { cacheProvider: null })
    while (!pipeline.highDensityRepairSolver && !pipeline.failed && !pipeline.solved) pipeline.step()
    expect(pipeline.failed).toBe(false)
    const native = pipeline.highDensityRepairSolver!
    expect(native.sampleEntries.length).toBeGreaterThan(80)
    const params: ConstructorParameters<typeof Pipeline4HighDensityRepairSolver>[0] = {
      nodeWithPortPoints: native.originalNodeWithPortPoints,
      hdRoutes: native.originalHdRoutes,
      obstacles: native.originalObstacles,
      connMap: native.connMap,
      colorMap: native.colorMap,
      repairMargin: native.repairMargin,
      minimumTraceWidth: native.minimumTraceWidth,
    }
    const parallel = new ParallelHighDensityRepairSolver({ ...params, workerPool: {
      workerCount: 4,
      run() { throw new Error("Constructor parity must not launch repair workers") },
    } })
    expect(createMemo(parallel, params)).toBeDefined()
    expect(hash(parallel.sampleEntries)).toBe(hash(native.sampleEntries))
    expect(parallel.MAX_ITERATIONS).toBe(native.MAX_ITERATIONS)
    expect(parallel.stats).toEqual(native.stats)
    expect(parallel.originalHdRoutes).toBe(native.originalHdRoutes)
    expect(parallel.connMap).toBe(native.connMap)
  }
})
