import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import type { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import connectedNetFixture from "../../fixtures/bug-reports/bugreport75-d7c4d8/bugreport75-d7c4d8.srj.json" with {
  type: "json",
}

type MaxViaCountReproConnection = SimpleRouteJson["connections"][number] & {
  maxViaCount?: number
}

test("repro: maxViaCount is ignored on a source trace in a net", (): void => {
  const simpleRouteJson = structuredClone(
    connectedNetFixture,
  ) as SimpleRouteJson
  const constrainedConnection = simpleRouteJson.connections.find(
    (connection) => connection.name === "source_trace_16",
  ) as MaxViaCountReproConnection | undefined
  if (!constrainedConnection) {
    throw new Error("Connected-net fixture is missing source_trace_16")
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
    throw new Error("Routed output is missing the source_trace_16 branch")
  }

  expect(constrainedRoutedConnection.__rootConnectionNames).toEqual([
    "source_trace_15",
    "source_trace_16",
  ])
  const connectedNetTraces = traces.filter((trace) =>
    trace.pcb_trace_id.startsWith(`${constrainedRoutedConnection.name}_`),
  )
  const constrainedTraceViaCount = connectedNetTraces
    .flatMap((trace) => trace.route)
    .filter((routePoint) => routePoint.route_type === "via").length

  expect(constrainedTraceViaCount).toBe(2)
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)

  const focusedBounds = {
    minX: -2,
    minY: 14,
    maxX: 4,
    maxY: 21,
  }
  const focusedSimpleRouteJson: SimpleRouteJson = {
    ...simpleRouteJson,
    bounds: focusedBounds,
    connections: simpleRouteJson.connections.filter((connection) =>
      ["source_trace_15", "source_trace_16"].includes(connection.name),
    ),
    obstacles: simpleRouteJson.obstacles.filter(
      (obstacle) =>
        obstacle.center.x + obstacle.width / 2 >= focusedBounds.minX &&
        obstacle.center.x - obstacle.width / 2 <= focusedBounds.maxX &&
        obstacle.center.y + obstacle.height / 2 >= focusedBounds.minY &&
        obstacle.center.y - obstacle.height / 2 <= focusedBounds.maxY,
    ),
    traces: connectedNetTraces,
  }
  expect(convertSrjToGraphicsObject(focusedSimpleRouteJson)).toMatchGraphicsSvg(
    import.meta.path,
  )
})
