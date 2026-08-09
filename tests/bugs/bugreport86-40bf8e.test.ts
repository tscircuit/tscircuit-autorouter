import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib"
import { migrateLegacyObstacleCircuitJsonMetadata } from "lib/testing/utils/migrate-legacy-obstacle-circuit-json-metadata"
import type { SimpleRouteJson } from "lib/types"
import bugReport from "../../fixtures/bug-reports/bugreport86-40bf8e/bugreport86-40bf8e.json" with {
  type: "json",
}
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

const srj = migrateLegacyObstacleCircuitJsonMetadata(
  structuredClone(bugReport.simple_route_json) as SimpleRouteJson,
)

test.skip("Pipeline9 routes LCD traces around the 76 preloaded traces in bugreport86-40bf8e", (): void => {
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(srj),
    {
      cacheProvider: null,
      effort: 1,
    },
  )

  solver.solve()

  expect(solver.error).toBeNull()
  expect(solver.failed).toBeFalse()
  expect(solver.solved).toBeTrue()
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})
