import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import type { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import solarBatteryCharger from "../../fixtures/bug-reports/bugreport68-solar-battery-charger/bugreport68-solar-battery-charger.srj.json" with {
  type: "json",
}

type MaxViaCountReproConnection = SimpleRouteJson["connections"][number] & {
  maxViaCount?: number
}

test("repro: maxViaCount is ignored on a source trace in a net", (): void => {
  const simpleRouteJson = structuredClone(
    solarBatteryCharger,
  ) as SimpleRouteJson
  const constrainedConnection = simpleRouteJson.connections.find(
    (connection) => connection.name === "source_trace_46",
  ) as MaxViaCountReproConnection | undefined
  if (!constrainedConnection) {
    throw new Error("Solar-charger fixture is missing source_trace_46")
  }
  constrainedConnection.maxViaCount = 0

  const solver = new AutoroutingPipelineSolver7_MultiGraph(simpleRouteJson, {
    cacheProvider: null,
  })
  solver.solve()

  const traces = solver.getPrePowerTraceOutputSimplifiedPcbTraces()
  const constrainedPointIds = new Set(
    constrainedConnection.pointsToConnect.map((point) => point.pointId),
  )
  const routedConnectionsForMergedNet =
    solver.srjWithPointPairs?.connections.filter((connection) =>
      connection.__rootConnectionNames?.includes(constrainedConnection.name),
    ) ?? []
  const constrainedRoutedConnection = routedConnectionsForMergedNet.find(
    (connection) =>
      connection.pointsToConnect.every((point) =>
        constrainedPointIds.has(point.pointId),
      ),
  )
  if (!constrainedRoutedConnection) {
    throw new Error("Routed output is missing the source_trace_46 branch")
  }

  const mergedNetTraceNames = new Set(
    routedConnectionsForMergedNet.map((connection) => connection.name),
  )
  const mergedNetViaCount = traces
    .filter((trace) =>
      Array.from(mergedNetTraceNames).some((connectionName) =>
        trace.pcb_trace_id.startsWith(`${connectionName}_`),
      ),
    )
    .flatMap((trace) => trace.route)
    .filter((routePoint) => routePoint.route_type === "via").length
  const constrainedTraceViaCount = traces
    .filter((trace) =>
      trace.pcb_trace_id.startsWith(`${constrainedRoutedConnection.name}_`),
    )
    .flatMap((trace) => trace.route)
    .filter((routePoint) => routePoint.route_type === "via").length

  expect(mergedNetViaCount).toBe(2)
  expect(constrainedTraceViaCount).toBe(0)
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(
    convertSrjToGraphicsObject({ ...simpleRouteJson, traces }),
  ).toMatchGraphicsSvg(import.meta.path)
})
