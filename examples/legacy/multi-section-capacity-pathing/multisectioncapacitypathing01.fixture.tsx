import { AutoroutingPipelineSolver } from "lib/solvers/AutoroutingPipelineSolver"
import { CapacityPathingMultiSectionSolver } from "lib/solvers/CapacityPathingSectionSolver/CapacityPathingMultiSectionSolver"
import { GenericSolverDebugger } from "lib/testing/GenericSolverDebugger"
import srj from "../assets/multisectioncapacitypathing1.json"
import pathingInput from "../assets/multisectioncapacitypathing1_pathingInput.json"
import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"

export default () => {
  return (
    <GenericSolverDebugger
      createSolver={() => {
        // const pipeline = new AutoroutingPipelineSolver(srj as any)

        // pipeline.solveUntilPhase("pathingSolver")

        const solver = new CapacityPathingMultiSectionSolver({
          ...(pathingInput[0] as any),
          colorMap: pathingInput[0].colorMap,
          hyperParameters: {
            MAX_CAPACITY_FACTOR: 1,
          },
        })

        return solver
      }}
    />
    // <AutoroutingPipelineDebugger srj={srj as any} />
  )
}
