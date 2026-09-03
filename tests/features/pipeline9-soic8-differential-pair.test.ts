import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import input from "../fixtures/pipeline9-soic8-differential-pair.json"

test("Pipeline9 preserves length matching beside SOIC8 terminal pads in final output", () => {
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    input as unknown as SimpleRouteJson,
    { cacheProvider: null },
  )
  solver.solve()
  expect(solver.failed).toBe(false)
  const output = solver.getOutputSimpleRouteJson()
  expect(output.traces).toHaveLength(2)
  const lengths = output.traces!.map((trace) => {
    const wirePoints = trace.route.filter(
      (point) => point.route_type === "wire",
    )
    return wirePoints.slice(1).reduce((length, point, index) => {
      const previousPoint = wirePoints[index]!
      return (
        length +
        Math.hypot(point.x - previousPoint.x, point.y - previousPoint.y)
      )
    }, 0)
  })
  expect(Math.max(...lengths) - Math.min(...lengths)).toBeLessThanOrEqual(0.05)
  expect(convertSrjToGraphicsObject(output)).toMatchGraphicsSvg(
    import.meta.path,
  )
})
