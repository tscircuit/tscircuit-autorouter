import { useMemo } from "react"
import { GenericSolverDebugger } from "lib/testing/GenericSolverDebugger"
import inputData from "fixtures/legacy/assets/simplifiedpathsolver1.json" with {
  type: "json",
}
import { SingleSimplifiedPathSolver5 } from "@tscircuit/trace-simplification-solver"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import simplifiedPathSolver7 from "fixtures/legacy/assets/simplifiedpathsolver7.json" with {
  type: "json",
}

export default () => {
  const createSolver = () => {
    return new SingleSimplifiedPathSolver5({
      ...(simplifiedPathSolver7 as any),
      connMap: new ConnectivityMap(simplifiedPathSolver7.connMap),
    })
  }

  return (
    <GenericSolverDebugger createSolver={createSolver} animationSpeed={100} />
  )
}
