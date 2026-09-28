import { useMemo } from "react"
import { GenericSolverDebugger } from "lib/testing/GenericSolverDebugger"
import inputData from "fixtures/legacy/assets/simplifiedpathsolver1.json" with {
  type: "json",
}
import { MultiSimplifiedPathSolver } from "@tscircuit/trace-simplification-solver"
import { createColorMapFromStrings } from "lib/solvers/colors"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"

export default () => {
  const createSolver = () => {
    // The JSON contains routes as first array item and obstacles as second array item
    const routes = inputData[0] as any[]
    const obstacles = inputData[1] as any[]

    return new MultiSimplifiedPathSolver({
      unsimplifiedHdRoutes: routes,
      obstacles,
      connMap: new ConnectivityMap({}),
      colorMap: createColorMapFromStrings(routes.map((r) => r.connectionName)),
    })
  }

  return <GenericSolverDebugger createSolver={createSolver} />
}
