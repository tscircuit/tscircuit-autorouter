import { GenericSolverDebugger } from "lib/testing/GenericSolverDebugger"
import { TraceKeepoutSolver } from "lib/solvers/TraceKeepoutSolver/TraceKeepoutSolver"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import input from "./keepoutsolver02-input.json"

export default () => {
  const createSolver = () => {
    const data = input[0] as any

    const connMap = new ConnectivityMap(data.connMap.netMap)

    return new TraceKeepoutSolver({
      hdRoutes: data.hdRoutes,
      obstacles: data.obstacles,
      connMap,
      colorMap: data.colorMap,
      keepoutRadiusSchedule: data.keepoutRadiusSchedule,
    })
  }

  return <GenericSolverDebugger createSolver={createSolver} />
}
