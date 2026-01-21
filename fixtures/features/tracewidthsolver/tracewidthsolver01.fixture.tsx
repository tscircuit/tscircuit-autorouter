import { GenericSolverDebugger } from "lib/testing/GenericSolverDebugger"
import { TraceWidthSolver } from "lib/solvers/TraceWidthSolver/TraceWidthSolver"
import input from "./tracewidthsolver01-input.json"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { SimpleRouteConnection } from "lib/types"

export default () => {
  const createSolver = () => {
    const data = input[0]
    const nominalTraceWidth = data.nominalTraceWidth ?? data.minTraceWidth * 2
    const connectionByName = new Map<string, SimpleRouteConnection>()
    for (const route of data.hdRoutes) {
      if (connectionByName.has(route.connectionName)) {
        continue
      }
      const start = route.route[0]
      const end = route.route[route.route.length - 1]
      connectionByName.set(route.connectionName, {
        name: route.connectionName,
        nominalTraceWidth,
        pointsToConnect: [
          { x: start.x, y: start.y, layer: "top" },
          { x: end.x, y: end.y, layer: "top" },
        ],
      })
    }

    return new TraceWidthSolver({
      ...(data as any),
      obstacles: data.obstacles ?? [],
      connection: Array.from(connectionByName.values()),
      connMap: new ConnectivityMap(data.connMap.netMap),
    })
  }

  return <GenericSolverDebugger createSolver={createSolver} />
}
