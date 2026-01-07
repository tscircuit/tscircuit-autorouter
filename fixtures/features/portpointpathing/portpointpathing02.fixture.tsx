import { GenericSolverDebugger } from "lib/testing/GenericSolverDebugger"
import { PortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import input from "./portpointpathing02-input.json"

export default () => {
  const createSolver = () => {
    return new PortPointPathingSolver({
      ...(input[0] as any),

      hyperParameters: {
        RIPPING_ENABLED: true,
        MAX_RIPS: 100,
        RIPPING_PF_THRESHOLD: 0.01,
        NODE_PF_FACTOR: 10000,
        NODE_PF_MAX_PENALTY: 10000,
        JUMPER_PF_FN_ENABLED: true,
      },
    })
  }

  return <GenericSolverDebugger createSolver={createSolver} />
}
