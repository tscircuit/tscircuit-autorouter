// @ts-nocheck
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { HighDensitySolver } from "lib/solvers/HighDensitySolver/HighDensitySolver"
import { GenericSolverDebugger } from "lib/testing/GenericSolverDebugger"
import stageInput from "./bugreport95-mangopi-r3c-high-density-timeout.input.json"

const createSolver = () => {
  const { connMapNetMap, ...solverParams } = stageInput.solverParams

  return new HighDensitySolver({
    ...solverParams,
    connMap: new ConnectivityMap(connMapNetMap),
  })
}

export default () => <GenericSolverDebugger createSolver={createSolver} />
