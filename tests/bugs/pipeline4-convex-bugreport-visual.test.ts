import { expect, test } from "bun:test"
import { getGlobalInMemoryCache } from "lib/cache/setupGlobalCaches"
import { AutoroutingPipelineSolver4 } from "lib/autorouter-pipelines/AutoroutingPipeline4_TinyHypergraph/AutoroutingPipelineSolver4_TinyHypergraph"
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "tests/fixtures/getLastStepSvg"
import bugreport44Fixture from "../../fixtures/bug-reports/bugreport44-0ec411/bugreport44-0ec411.json"

const snapshotBugReport = (
  snapshotName: string,
  input: SimpleRouteJson,
  opts?: ConstructorParameters<typeof AutoroutingPipelineSolver4>[1],
) => {
  getGlobalInMemoryCache().clearCache()

  const solver = new AutoroutingPipelineSolver4(structuredClone(input), opts)
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)

  expect(getLastStepSvg(solver.nodeSolver!.visualize())).toMatchSvgSnapshot(
    import.meta.path,
    { svgName: `${snapshotName}-mesh` },
  )
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
    { svgName: `${snapshotName}-final` },
  )
}

test("pipeline4 bugreport44 convex visual snapshots", () => {
  snapshotBugReport(
    "bugreport44",
    structuredClone(bugreport44Fixture.simple_route_json as SimpleRouteJson),
  )
}, 120_000)

test.todo("pipeline4 bugreport46 convex visual snapshots", () => {})
