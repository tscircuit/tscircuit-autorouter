import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/autorouting-pipeline-solver9-preloaded-trace-graph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import simpleRouteJson from "../../fixtures/bug-reports/rp2350-full-board-drc-repro/rp2350-full-board-ground-phase.srj.json" with {
  type: "json",
}
import { getGraphicsSvgFrames } from "../fixtures/solver-svg-frames"

test("Pipeline9 leaves DRC violations after the RP2350 full-board ground phase", () => {
  const srj = structuredClone(simpleRouteJson) as SimpleRouteJson
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
    cacheProvider: null,
    effort: 1,
    visualizationTraceColorMode: "layer",
  })

  expect(srj.connections).toHaveLength(5)
  expect(srj.obstacles).toHaveLength(300)
  expect(srj.traces).toHaveLength(175)

  solver.solve()

  expect(solver.error).toBeNull()
  expect(solver.failed).toBeFalse()
  expect(solver.solved).toBeTrue()

  const routedTraces = solver.getOutputSimplifiedPcbTraces()
  const { errors } = evaluateRelaxedDrc({
    inputSrj: srj,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces,
  })

  // This is the reproduced bug: routing completes, but the final board is not
  // DRC-clean. A repair should reduce this to zero without breaking routing.
  expect(errors).toHaveLength(76)

  const graphics = convertSrjToGraphicsObject(
    { ...srj, traces: routedTraces },
    { traceColorMode: "layer" },
  )
  graphics.circles = [
    ...(graphics.circles ?? []),
    ...errors.flatMap((error, index) =>
      error.center
        ? [
            {
              center: error.center,
              radius: 0.35,
              stroke: "#ff0000",
              fill: "rgba(255, 0, 0, 0.16)",
              label: `DRC ${index + 1}: ${error.error_type}`,
            },
          ]
        : [],
    ),
  ]

  expect(
    getGraphicsSvgFrames({
      frames: [
        {
          name: `RP2350 full-board ground phase — ${errors.length} relaxed DRC violations remain`,
          pipeline: "end",
          iteration: solver.iterations,
          graphics,
        },
      ],
      columns: 1,
      backgroundColor: "white",
    }),
  ).toMatchSvgSnapshot(import.meta.path, {
    svgName: "routed-with-drc-markers",
    tolerance: 0.01,
  })
}, 600_000)
