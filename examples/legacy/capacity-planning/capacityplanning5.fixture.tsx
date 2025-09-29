import { GenericSolverDebugger } from "lib/testing/GenericSolverDebugger"
// @ts-ignore
import inputData from "../assets/capacityplanning5.json"
import { CapacityPathingSolver5 } from "lib/solvers/CapacityPathingSolver/CapacityPathingSolver5"

export default () => {
  return (
    <GenericSolverDebugger
      createSolver={() => {
        const solver = new CapacityPathingSolver5({
          ...(inputData as any)[0],
        })
        return solver
      }}
    />
  )
}
