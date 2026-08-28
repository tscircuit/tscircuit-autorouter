import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"
import simpleRouteJson from "../../public/fixtures/bugreport101-cm5-spi-routing-timeout.srj.json" with {
  type: "json",
}
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

const RUN_TIMEOUT_REPRO =
  process.env.RUN_BUGREPORT101_CM5_SPI_ROUTING_TIMEOUT === "1"
const EXPECTED_MAX_RUNTIME_MS = 120_000
const EXPECTED_MAX_RELAXED_DRC_ERRORS = 47

test("bugreport101 captures the CM5 dual-SPI Pipeline 7 timeout", () => {
  const srj = structuredClone(simpleRouteJson) as SimpleRouteJson
  const solver = new AutoroutingPipelineSolver7_MultiGraph(srj, {
    cacheProvider: null,
    effort: 1,
    experimentalHighDensitySearchOptimization: true,
  })

  expect(srj.layerCount).toBe(4)
  expect(srj.connections).toHaveLength(37)
  expect(srj.obstacles).toHaveLength(336)
  expect(srj.traces ?? []).toHaveLength(0)
  const terminalCount = srj.connections.reduce(
    (sum, connection) => sum + connection.pointsToConnect.length,
    0,
  )
  expect(terminalCount).toBe(190)
  expect(terminalCount - srj.connections.length).toBe(153)
  expect(
    srj.connections.find((connection) => connection.name === "source_net_0")
      ?.pointsToConnect,
  ).toHaveLength(82)
  expect(
    srj.connections.find((connection) => connection.name === "source_net_1")
      ?.pointsToConnect,
  ).toHaveLength(19)
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
    { svgName: "unrouted", tolerance: 0 },
  )

  // The input snapshot remains cheap and CI-reviewed. The full solve is opt-in
  // because the regression currently takes many minutes on this modest board.
  if (!RUN_TIMEOUT_REPRO) return

  const startedAt = performance.now()
  solver.solve()
  const elapsedMs = performance.now() - startedAt
  const finalDrc = evaluateRelaxedDrc({
    inputSrj: srj,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  })

  console.info(
    JSON.stringify(
      {
        elapsedMs: Math.round(elapsedMs),
        iterations: solver.iterations,
        finalDrcErrorCount: finalDrc.errors.length,
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
  expect(finalDrc.errors.length).toBeLessThanOrEqual(
    EXPECTED_MAX_RELAXED_DRC_ERRORS,
  )
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
    { svgName: "routed", tolerance: 0 },
  )
  expect(elapsedMs).toBeLessThan(EXPECTED_MAX_RUNTIME_MS)
})
