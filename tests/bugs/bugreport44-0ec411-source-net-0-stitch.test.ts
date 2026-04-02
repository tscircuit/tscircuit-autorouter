import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver4 } from "lib/autorouter-pipelines/AutoroutingPipeline4_TinyHypergraph/AutoroutingPipelineSolver4_TinyHypergraph"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import bugReport from "../../fixtures/bug-reports/bugreport44-0ec411/bugreport44-0ec411.json" with {
  type: "json",
}

const TARGET_CONNECTION = "source_net_0_mst0"

const getMaxSameLayerSegmentLength = (route: HighDensityIntraNodeRoute) =>
  route.route.slice(0, -1).reduce((maxLength, point, index) => {
    const nextPoint = route.route[index + 1]!
    if (point.z !== nextPoint.z) return maxLength
    return Math.max(
      maxLength,
      Math.hypot(nextPoint.x - point.x, nextPoint.y - point.y),
    )
  }, 0)

test("bugreport44 stitch avoids long diagonal jump in source_net_0_mst0", () => {
  const pipeline = new AutoroutingPipelineSolver4(
    structuredClone(bugReport.simple_route_json as any),
  )

  pipeline.solveUntilPhase("traceSimplificationSolver")

  const stitchedRoutes =
    pipeline.highDensityStitchSolver?.mergedHdRoutes.filter(
      (route) => route.connectionName === TARGET_CONNECTION,
    ) ?? []

  expect(stitchedRoutes).toHaveLength(1)
  expect(getMaxSameLayerSegmentLength(stitchedRoutes[0]!)).toBeLessThan(2)
}, 120_000)
