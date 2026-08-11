import { GenericSolverDebugger } from "lib/testing/GenericSolverDebugger"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import type { SimpleRouteJson } from "lib/types"
import solverInput from "./bugreport89-issue2065-default.solver-input.json"

export default () => {
  const createSolver = () =>
    new AutoroutingPipelineSolver7_MultiGraph(
      structuredClone(solverInput.input) as SimpleRouteJson,
      solverInput.options,
    )

  return <GenericSolverDebugger createSolver={createSolver} />
}
