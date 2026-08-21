import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import type { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import bugreport73Qfp16 from "../../fixtures/bug-reports/bugreport73-qfp16/bugreport73-qfp16.srj.json" with {
  type: "json",
}

type MaxViaCountReproConnection = SimpleRouteJson["connections"][number] & {
  maxViaCount?: number
}

test("repro: a real QFP16 route ignores maxViaCount", (): void => {
  const simpleRouteJson = structuredClone(bugreport73Qfp16) as SimpleRouteJson
  const constrainedConnection = simpleRouteJson.connections.find(
    (connection) => connection.name === "source_trace_2",
  ) as MaxViaCountReproConnection | undefined
  if (!constrainedConnection) {
    throw new Error("QFP16 fixture is missing source_trace_2")
  }
  constrainedConnection.maxViaCount = 0

  const solver = new AutoroutingPipelineSolver7_MultiGraph(simpleRouteJson, {
    cacheProvider: null,
  })
  solver.solve()

  const traces = solver.getPrePowerTraceOutputSimplifiedPcbTraces()
  const constrainedTraces = traces.filter(
    (trace) => trace.connection_name === "source_trace_2",
  )
  const routedViaCount = constrainedTraces
    .flatMap((trace) => trace.route)
    .filter((routePoint) => routePoint.route_type === "via").length
  expect(routedViaCount).toBe(2)
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  const focusedBounds = {
    minX: -6.5,
    minY: -4.8,
    maxX: 3.2,
    maxY: 0.2,
  }
  expect(
    convertSrjToGraphicsObject({
      ...simpleRouteJson,
      bounds: focusedBounds,
      connections: [constrainedConnection],
      obstacles: simpleRouteJson.obstacles.filter(
        (obstacle) =>
          obstacle.center.x + obstacle.width / 2 >= focusedBounds.minX &&
          obstacle.center.x - obstacle.width / 2 <= focusedBounds.maxX &&
          obstacle.center.y + obstacle.height / 2 >= focusedBounds.minY &&
          obstacle.center.y - obstacle.height / 2 <= focusedBounds.maxY,
      ),
      traces: constrainedTraces,
    }),
  ).toMatchGraphicsSvg(import.meta.path)
})
