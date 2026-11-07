import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { pointToSegmentDistance } from "@tscircuit/math-utils"
import { TraceSimplificationSolver } from "@tscircuit/trace-simplification-solver"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getRvboyEscapeHandoffView } from "../../../fixtures/bug-reports/rvboy-escape-via-handoff/getRvboyEscapeHandoffView"
import source from "../../../fixtures/bug-reports/rvboy-escape-via-handoff/source.json"

test("native simplification preserves clearance around planned RVboy escape vias", async (): Promise<void> => {
  const fixture = new URL(
    "../../../fixtures/bug-reports/rvboy-escape-via-handoff/",
    import.meta.url,
  )
  const input = JSON.parse(
    gunzipSync(
      new Uint8Array(readFileSync(new URL("input.srj.json.gz", fixture))),
    ).toString(),
  )
  const stitched = JSON.parse(
    gunzipSync(
      new Uint8Array(readFileSync(new URL("stitched.hd.json.gz", fixture))),
    ).toString(),
  )
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })
  while (!pipeline.netToPointPairsSolver?.solved && !pipeline.failed)
    pipeline.step()
  expect(pipeline.failed).toBe(false)
  // Replay the captured stitch output at the real pipeline stage boundary.
  // No input obstacles, routes, or nearby copper are cropped out of the solve.
  Object.assign(pipeline, {
    highDensityStitchSolver: { mergedHdRoutes: stitched },
    highDensityRouteSolver: {
      fixedRouteReplacements: new Map(),
      preloadedTraceMutationMasks: new Map(),
      getUpdatedFixedHdRoutes: () => [],
    },
  })
  const step = pipeline.pipelineDef.find(
    (entry) => entry.solverName === "traceSimplificationSolver",
  )!
  const params = step.getConstructorParams(
    pipeline,
  )[0] as ConstructorParameters<typeof TraceSimplificationSolver>[0]
  const solver = new TraceSimplificationSolver(params)
  solver.solve()
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  const target = solver.simplifiedHdRoutes.find(
    (route) => route.connectionName === source.connectionName,
  )!
  const gap = Math.min(
    ...target.route.slice(1).flatMap((point, index) => {
      const previous = target.route[index]!
      return point.z === previous.z
        ? [
            pointToSegmentDistance(source.via, previous, point) -
              source.via.diameter / 2 -
              target.traceThickness / 2,
          ]
        : []
    }),
  )
  expect(gap).toBeGreaterThanOrEqual(input.minTraceToPadEdgeClearance)
  expect(target.route[0]).toEqual(
    stitched.find(
      (route: typeof target) => route.connectionName === source.connectionName,
    ).route[0],
  )
  expect(target.route.at(-1)).toEqual(
    stitched
      .find(
        (route: typeof target) =>
          route.connectionName === source.connectionName,
      )
      .route.at(-1),
  )
  await expect(
    getRvboyEscapeHandoffView(solver.simplifiedHdRoutes),
  ).toMatchSvgSnapshot(import.meta.path)
})
