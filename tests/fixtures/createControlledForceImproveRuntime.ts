import type { SolverRuntimeExecutor } from "@tscircuit/solver-utils"
import {
  Pipeline9HighDensityForceImproveSampleSolver,
  type Pipeline9HighDensityForceImproveSampleInput,
  type Pipeline9HighDensityForceImproveSampleOutput,
} from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityForceImproveSampleSolver"

type ControlledForceTask = {
  input: Pipeline9HighDensityForceImproveSampleInput
  finish: () => void
  reject: (error: Error) => void
}

export function createControlledForceImproveRuntime(): {
  runtime: SolverRuntimeExecutor
  tasks: ControlledForceTask[]
} {
  const tasks: ControlledForceTask[] = []
  const runtime = {
    executeAsync: (
      Solver: typeof Pipeline9HighDensityForceImproveSampleSolver,
      input: Pipeline9HighDensityForceImproveSampleInput,
    ): Promise<Pipeline9HighDensityForceImproveSampleOutput> => {
      if (Solver !== Pipeline9HighDensityForceImproveSampleSolver) {
        throw new Error("Unexpected force worker class")
      }
      const isolatedInput = structuredClone(input)
      return new Promise((resolve, reject): void => {
        tasks.push({
          input: isolatedInput,
          finish: (): void => {
            const sample = new Solver(isolatedInput)
            sample.solve()
            resolve(sample.getOutput())
          },
          reject,
        })
      })
    },
  } as SolverRuntimeExecutor
  return { runtime, tasks }
}
