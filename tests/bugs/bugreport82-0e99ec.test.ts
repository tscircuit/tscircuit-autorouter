import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph as AutoroutingPipelineSolver } from "lib"
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"
import bugReport from "../../fixtures/bug-reports/bugreport82-0e99ec/bugreport82-0e99ec.json" with {
  type: "json",
}

const srj = bugReport.simple_route_json as SimpleRouteJson

test("bugreport82-0e99ec.json", () => {
  // Additional force-improvement passes can move these crossing USB routes'
  // vias beyond the available tuning space. Keep the successful routing budget
  // explicit while enforcing the migrated pair's unchanged 0.5mm limit.
  const solver = new AutoroutingPipelineSolver(srj, { effort: 0.5 })
  let routingError: unknown

  try {
    solver.solve()
  } catch (error) {
    routingError = error
  }

  expect(routingError).toBeUndefined()
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  const traces = solver.getOutputSimplifiedPcbTraces()
  const lengths = srj.differentialPairs![0]!.connectionNames.map((lane) =>
    lane.reduce((total, name) => {
      const hops = traces.filter((trace) => trace.connection_name === name)
      expect(hops).toHaveLength(1)
      const points = hops[0]!.route.flatMap((point) =>
        point.route_type === "wire" || point.route_type === "via"
          ? [point]
          : [],
      )
      return (
        total +
        points
          .slice(1)
          .reduce(
            (length, point, index) =>
              length +
              Math.hypot(
                point.x - points[index]!.x,
                point.y - points[index]!.y,
              ),
            0,
          )
      )
    }, 0),
  )
  expect(Math.abs(lengths[0]! - lengths[1]!)).toBeLessThanOrEqual(0.5 + 1e-9)

  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})
