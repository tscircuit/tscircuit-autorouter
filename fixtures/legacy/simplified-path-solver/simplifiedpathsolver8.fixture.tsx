import { useMemo } from "react"
import { GenericSolverDebugger } from "lib/testing/GenericSolverDebugger"
import inputData from "fixtures/legacy/assets/simplifiedpathsolver1.json" with {
  type: "json",
}
import { SingleSimplifiedPathSolver5 } from "@tscircuit/trace-simplification-solver"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import simplifiedPathSolver8 from "fixtures/legacy/assets/simplifiedpathsolver8.json" with {
  type: "json",
}

export default () => {
  const createSolver = () => {
    return new SingleSimplifiedPathSolver5({
      ...(simplifiedPathSolver8 as any),
      connMap: new ConnectivityMap(simplifiedPathSolver8.connMap),
    })
  }

  return <GenericSolverDebugger createSolver={createSolver} />
}
