import { GenericSolverDebugger } from "lib/testing/GenericSolverDebugger"
import inputData from "fixtures/legacy/assets/simplifiedpathsolver4.json" with {
  type: "json",
}
import { MultiSimplifiedPathSolver } from "@tscircuit/trace-simplification-solver"
import { createColorMapFromStrings } from "lib/solvers/colors"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"

export default () => {
  const createSolver = () => {
    return new MultiSimplifiedPathSolver({
      ...(inputData[0] as any),
      connMap: new ConnectivityMap(inputData[0].connMap.netMap),
    })
  }

  return <GenericSolverDebugger createSolver={createSolver} />
}
