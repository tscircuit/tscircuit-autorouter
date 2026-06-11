/**
 * One-off diagnostic: run the tiny-hypergraph port-point solver on the srj18
 * sample001 input and attribute the post-solve retained heap by nulling
 * suspect fields one at a time with forced GC in between.
 */
import { TinyHypergraphPortPointPathingSolver } from "../lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import { extractPipeline7PortPointPathingParams } from "./analyze-portpoint-tiny-memory"

const mib = (bytes: number) => (bytes / 1048576).toFixed(1)

const gcHeap = async () => {
  for (let i = 0; i < 3; i++) {
    Bun.gc(true)
    await Bun.sleep(25)
  }
  return process.memoryUsage().heapUsed
}

const main = async () => {
  const { params } = await extractPipeline7PortPointPathingParams(1)
  const solver = new TinyHypergraphPortPointPathingSolver(
    structuredClone(params),
  )
  solver.solve()
  solver.getOutput()
  console.log(`solved=${solver.solved} failed=${solver.failed}`)

  let heap = await gcHeap()
  console.log(`after-solve+getOutput heap=${mib(heap)} MiB`)

  const anySolver = solver as any
  const pipeline = anySolver.tinyPipelineSolver

  const solveGraphSolver = pipeline?.getSolver?.("solveGraph")
  console.log(
    `solveGraph._problemSetup present: ${solveGraphSolver?._problemSetup !== undefined}`,
  )
  console.log(
    `pipeline.cachedSectionStageParams present: ${pipeline?.cachedSectionStageParams !== undefined}`,
  )
  console.log(
    `pipeline.optimizeSection solver present: ${pipeline?.getSolver?.("optimizeSection") !== undefined}`,
  )
  console.log(
    `pipeline.initialVisualizationSolver present: ${pipeline?.initialVisualizationSolver !== undefined}`,
  )

  const probes: Array<[string, () => void]> = [
    [
      "solveGraphSolver._problemSetup",
      () => {
        if (solveGraphSolver) solveGraphSolver._problemSetup = undefined
      },
    ],
    [
      "solveGraphSolver.state.regionIntersectionCaches",
      () => {
        if (solveGraphSolver) solveGraphSolver.state.regionIntersectionCaches = []
      },
    ],
    [
      "solveGraphSolver.state (entire)",
      () => {
        if (solveGraphSolver) solveGraphSolver.state = null
      },
    ],
    [
      "pipeline.solveGraph reference + topology/problem",
      () => {
        if (solveGraphSolver) {
          solveGraphSolver.topology = null
          solveGraphSolver.problem = null
        }
        if (pipeline) pipeline.solveGraph = null
      },
    ],
    [
      "pipeline.pipelineOutputs",
      () => {
        if (pipeline) pipeline.pipelineOutputs = {}
      },
    ],
    [
      "pipeline.cachedSectionStageParams + masks",
      () => {
        if (pipeline) {
          pipeline.cachedSectionStageParams = undefined
          pipeline.selectedSectionMask = undefined
        }
      },
    ],
    [
      "wrapper.duplicateCongestedPortReport",
      () => {
        anySolver.duplicateCongestedPortReport = undefined
      },
    ],
    [
      "wrapper.graphForInputNodes",
      () => {
        anySolver.graphForInputNodes = null
      },
    ],
    [
      "wrapper.inputNodeWithPortPoints + originalRegionById",
      () => {
        anySolver.inputNodeWithPortPoints = undefined
        anySolver.originalRegionById = null
        anySolver.originalRegionIds = null
      },
    ],
    [
      "wrapper.params",
      () => {
        anySolver.params = null
      },
    ],
    [
      "wrapper.tinyPipelineSolver (entire)",
      () => {
        anySolver.tinyPipelineSolver = null
      },
    ],
  ]

  for (const [label, drop] of probes) {
    drop()
    const next = await gcHeap()
    console.log(`freed ${mib(heap - next).padStart(7)} MiB by dropping ${label} (heap now ${mib(next)})`)
    heap = next
  }
}

await main()
