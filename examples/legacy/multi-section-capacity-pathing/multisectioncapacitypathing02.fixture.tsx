import { AutoroutingPipelineSolver } from "lib/solvers/AutoroutingPipelineSolver"
import { CapacityPathingMultiSectionSolver } from "lib/solvers/CapacityPathingSectionSolver/CapacityPathingMultiSectionSolver"
import { GenericSolverDebugger } from "lib/testing/GenericSolverDebugger"
import pathingInput from "../assets/multisectioncapacitypathing2.json"
import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"

export default () => {
  return (
    <GenericSolverDebugger
      createSolver={() => {
        // const pipeline = new AutoroutingPipelineSolver(srj as any)

        // pipeline.solveUntilPhase("pathingSolver")

        const solver = new CapacityPathingMultiSectionSolver({
          ...(pathingInput as any)[0],
        })

        return solver
      }}
    />
    // <AutoroutingPipelineDebugger srj={srj as any} />
  )
}
