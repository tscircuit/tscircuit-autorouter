import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver4 } from "lib/autorouter-pipelines/AutoroutingPipeline4_TinyHypergraph/AutoroutingPipelineSolver4_TinyHypergraph"
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "tests/fixtures/getLastStepSvg"
import e2e3Fixture from "../../fixtures/legacy/assets/e2e3.json"

test("pipeline4 e2e3 convex-region visual snapshots", () => {
  const solver = new AutoroutingPipelineSolver4(
    structuredClone(e2e3Fixture as SimpleRouteJson),
  )

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)

  const stitchedRoutes = solver.highDensityStitchSolver?.mergedHdRoutes ?? []
  expect(
    stitchedRoutes.filter((route) => route.connectionName === "source_trace_2"),
  ).toHaveLength(1)
  expect(
    stitchedRoutes.filter((route) => route.connectionName === "source_trace_8"),
  ).toHaveLength(1)
  expect(
    stitchedRoutes.filter((route) => route.connectionName === "source_trace_9"),
  ).toHaveLength(1)

  expect(getLastStepSvg(solver.nodeSolver!.visualize())).toMatchSvgSnapshot(
    import.meta.path,
    { svgName: "mesh" },
  )
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
    { svgName: "final" },
  )
}, 60_000)
