import { useMemo } from "react"
import { GenericSolverDebugger } from "lib/testing/GenericSolverDebugger"
import inputData from "examples/legacy/assets/simplifiedpathsolver1.json"
import { SingleSimplifiedPathSolver5 } from "lib/solvers/SimplifiedPathSolver/SingleSimplifiedPathSolver5_Deg45"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"

export default () => {
  const createSolver = () => {
    // The JSON contains routes as first array item and obstacles as second array item
    const routes = inputData[0] as any[]
    const obstacles = inputData[1] as any[]

    // Use the first route as input route and the rest as other routes
    const inputRoute = routes[0]
    const otherRoutes = routes.slice(1)

    return new SingleSimplifiedPathSolver5({
      inputRoute,
      otherHdRoutes: otherRoutes,
      obstacles,
      connMap: new ConnectivityMap({}),
      colorMap: {},
    })
  }

  return (
    <GenericSolverDebugger createSolver={createSolver} animationSpeed={100} />
  )
}
