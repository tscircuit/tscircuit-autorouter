import type { HighDensityRoute } from "lib/types/high-density-types"
import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { convertSimplifiedPcbTraceToHighDensityRoute } from "lib/autorouter-pipelines/AutoroutingPipeline11_Simplification/convertSimplifiedPcbTraceToHighDensityRoute"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { getDifferentialPairSeriesRepro } from "../fixtures/getDifferentialPairSeriesRepro"

test("unequal hop lists sum copper without bridging a series resistor or changing roots", async (): Promise<void> => {
  const srj = await getDifferentialPairSeriesRepro()
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
    cacheProvider: null,
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  const output = solver.getOutputSimplifiedPcbTraces()
  expect(output).toHaveLength(3)
  const connMap = getConnectivityMapFromSimpleRouteJson(srj)
  const routes = output.map(
    (trace): HighDensityRoute =>
      convertSimplifiedPcbTraceToHighDensityRoute(trace, {
        layerCount: srj.layerCount,
        defaultTraceThickness: srj.minTraceWidth,
        defaultViaDiameter: 0.3,
        rootConnectionName: connMap.getNetConnectedToId(trace.connection_name)!,
      }),
  )
  const lengths = routes.map((route): number =>
    route.route
      .slice(1)
      .reduce(
        (length, point, index): number =>
          length +
          Math.hypot(
            point.x - route.route[index]!.x,
            point.y - route.route[index]!.y,
          ),
        0,
      ),
  )
  expect(lengths[0]! + lengths[1]!).toBeCloseTo(lengths[2]!, 1)
  expect(lengths[0]! + lengths[1]!).toBeLessThan(10.05)
  const hdRoutes = solver._getOutputHdRoutes()
  const before = hdRoutes.find(
    (route): boolean => route.connectionName === "P:before",
  )!
  const after = hdRoutes.find(
    (route): boolean => route.connectionName === "P:after",
  )!
  expect(before.rootConnectionName).not.toBe(after.rootConnectionName)
  for (const connection of srj.connections) {
    expect(
      output.find(
        (trace): boolean => trace.connection_name === connection.name,
      )!.source_trace_id,
    ).toBe(connection.source_trace_id)
  }
})
