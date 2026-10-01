import { dataset as datasetSrj24 } from "@tscircuit/dataset-srj24"
import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

const RUN_TIMEOUT_REPRO =
  process.env.RUN_PMP23595_SAMPLE21_TIMEOUT_REPRO === "1"
const EXPECTED_MAX_RUNTIME_MS = 60_000

test("PMP23595 sample021 routes within the benchmark timeout", () => {
  const srj = structuredClone(datasetSrj24.sample021) as SimpleRouteJson
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
    cacheProvider: null,
    effort: 1,
  })

  expect(srj.layerCount).toBe(6)
  expect(srj.connections).toHaveLength(75)
  expect(srj.obstacles).toHaveLength(538)
  expect(srj.traces ?? []).toHaveLength(0)
  expect(
    srj.connections.reduce(
      (terminalCount, connection) =>
        terminalCount + connection.pointsToConnect.length,
      0,
    ),
  ).toBe(533)
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
    { svgName: "unrouted", tolerance: 0 },
  )

  if (!RUN_TIMEOUT_REPRO) return

  const startedAt = performance.now()
  solver.solve()
  const elapsedMs = performance.now() - startedAt

  console.info(
    JSON.stringify(
      {
        elapsedMs: Math.round(elapsedMs),
        iterations: solver.iterations,
        phaseMs: Object.fromEntries(
          Object.entries(solver.timeSpentOnPhase).map(([phase, durationMs]) => [
            phase,
            Math.round(durationMs),
          ]),
        ),
      },
      null,
      2,
    ),
  )
  expect(solver.error).toBeNull()
  expect(solver.failed).toBeFalse()
  expect(solver.solved).toBeTrue()
  const routedTraces = solver.getOutputSimplifiedPcbTraces()
  expect(routedTraces).toHaveLength(460)
  expect(
    evaluateRelaxedDrc({
      inputSrj: srj,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces,
    }).errors,
  ).toEqual([])
  expect(
    getSvgFromGraphicsObject(solver.visualizeFinalOutput(), {
      backgroundColor: "white",
    }),
  ).toMatchSvgSnapshot(import.meta.path, {
    svgName: "routed",
    tolerance: 0,
  })
  expect(elapsedMs).toBeLessThan(EXPECTED_MAX_RUNTIME_MS)
})
