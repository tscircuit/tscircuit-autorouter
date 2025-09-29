import { CapacityPathingMultiSectionSolver } from "lib/solvers/CapacityPathingSectionSolver/CapacityPathingMultiSectionSolver"
import { GenericSolverDebugger } from "lib/testing/GenericSolverDebugger"
import pathingInput from "../assets/multisectioncapacitypathing3.json"

export default () => {
  return (
    <GenericSolverDebugger
      createSolver={() => {
        const solver = new CapacityPathingMultiSectionSolver({
          ...(pathingInput as any)[0],
        })

        return solver
      }}
    />
  )
}
