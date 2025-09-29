import { useMemo } from "react"
import { GenericSolverDebugger } from "lib/testing/GenericSolverDebugger"
import inputData from "examples/legacy/assets/simplifiedpathsolver1.json"
import { SingleSimplifiedPathSolver5 } from "lib/solvers/SimplifiedPathSolver/SingleSimplifiedPathSolver5_Deg45"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import simplifiedPathSolver7 from "examples/legacy/assets/simplifiedpathsolver7.json"

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
