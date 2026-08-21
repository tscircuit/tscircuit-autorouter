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
  constrainedConnection.maxViaCount = 1

  const solver = new AutoroutingPipelineSolver7_MultiGraph(simpleRouteJson, {
    cacheProvider: null,
  })
  solver.solve()

  const traces = solver.getPrePowerTraceOutputSimplifiedPcbTraces()
  const routedViaCount = traces
    .filter((trace) => trace.connection_name === "source_trace_2")
    .flatMap((trace) => trace.route)
    .filter((routePoint) => routePoint.route_type === "via").length
  expect(routedViaCount).toBe(2)
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(
    convertSrjToGraphicsObject({ ...simpleRouteJson, traces }),
  ).toMatchGraphicsSvg(import.meta.path)
})
