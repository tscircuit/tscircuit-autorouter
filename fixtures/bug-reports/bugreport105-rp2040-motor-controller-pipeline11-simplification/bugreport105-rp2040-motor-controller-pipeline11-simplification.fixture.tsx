import { AutoroutingPipelineSolver11_Simplification } from "lib"
import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import type { SimpleRouteJson } from "lib/types"
import rp2040MotorControllerSrj from "../../real-boards/rp2040-motor-controller-board.srj.json" with {
  type: "json",
}

// Captured from https://tscircuit.com/imrishabh18/rp2040-motor-controller
// at tscircuit/rp2040-motor-controller commit b4560e5.
const inputSrj = rp2040MotorControllerSrj as SimpleRouteJson

export default () => (
  <AutoroutingPipelineDebugger
    srj={inputSrj}
    createSolver={(srj) =>
      new AutoroutingPipelineSolver11_Simplification(srj)
    }
  />
)
