import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { Pipeline9JointDrcRepairSolver } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { Pipeline9Repair04Solver } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9Repair04Solver"
import type { SimpleRouteJson } from "../../lib/types"

type Pipeline9Step =
  AutoroutingPipelineSolver9_PreloadedTraceGraph["pipelineDef"][number]
type Repair04Step = Extract<
  Pipeline9Step,
  { solverClass: typeof Pipeline9Repair04Solver }
>
type JointRepairStep = Extract<
  Pipeline9Step,
  { solverClass: typeof Pipeline9JointDrcRepairSolver }
>

export type Repair04BenchmarkMode = "baseline" | "candidate"

export const REPAIR04_BENCHMARK_PIPELINE_VARIANTS = {
  baseline: "pipeline9-without-repair04-benchmark-v1",
  candidate: "pipeline9-production",
} as const

// This class is deliberately confined to benchmark code. The inherited
// constructor and output preserve the same route references as the historical
// baseline, while neither reference nor indexed DRC is evaluated by this stage.
class Repair04BenchmarkBaselineSolver extends Pipeline9Repair04Solver {
  override _step(): void {
    this.stats = {
      regions: 0,
      acceptedRegions: 0,
      indexedErrors: null,
      referenceErrors: null,
      completionReason: "benchmark-baseline",
    }
    this.solved = true
  }
}

/** Construct production routing or an explicitly defined benchmark baseline. */
export function createRepair04BenchmarkPipeline(
  srj: SimpleRouteJson,
  mode: Repair04BenchmarkMode,
  options: ConstructorParameters<
    typeof AutoroutingPipelineSolver9_PreloadedTraceGraph
  >[1] = {},
): AutoroutingPipelineSolver9_PreloadedTraceGraph {
  if (mode !== "baseline" && mode !== "candidate")
    throw new Error(`Unknown repair04 benchmark mode: ${mode}`)
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    srj,
    options,
  )
  if (mode === "candidate") return pipeline

  const repairStageNames = ["repair04Solver", "repair04AdvancedSolver"]
  for (const name of repairStageNames) {
    const stages = pipeline.pipelineDef.filter(
      (stage): boolean => stage.solverName === name,
    )
    if (
      stages.length !== 1 ||
      stages[0]!.solverClass !== Pipeline9Repair04Solver
    )
      throw new Error(
        `Benchmark baseline requires the production ${name} stage`,
      )
  }
  const jointStages = pipeline.pipelineDef.filter(
    (stage): boolean => stage.solverName === "pipeline9JointDrcRepairSolver",
  )
  if (
    jointStages.length !== 1 ||
    jointStages[0]!.solverClass !== Pipeline9JointDrcRepairSolver
  )
    throw new Error(
      "Benchmark baseline requires the production joint repair stage",
    )

  pipeline.pipelineDef = pipeline.pipelineDef.map((stage): Pipeline9Step => {
    if (repairStageNames.includes(stage.solverName)) {
      // The unique name and production class were verified above.
      const repairStage = stage as Repair04Step
      return { ...repairStage, solverClass: Repair04BenchmarkBaselineSolver }
    }
    if (stage.solverName !== "pipeline9JointDrcRepairSolver") return stage
    const jointStage = stage as JointRepairStep
    return {
      ...jointStage,
      solverClass: Pipeline9JointDrcRepairSolver,
      getConstructorParams: (
        instance: AutoroutingPipelineSolver9_PreloadedTraceGraph,
      ): ConstructorParameters<typeof Pipeline9JointDrcRepairSolver> => {
        const [params] = jointStage.getConstructorParams(instance)
        // The historical baseline also omitted the final guard added with
        // repair04. Every other joint repair input remains production-defined.
        return [{ ...params, finalReferenceDrcEvaluator: undefined }]
      },
    }
  })
  return pipeline
}
