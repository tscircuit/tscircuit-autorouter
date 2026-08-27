import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib"
import type { SimpleRouteJson } from "lib/types"
import simpleRouteJson from "../../fixtures/bug-reports/cm5-spi-routing-timeout/cm5-spi-routing-timeout.srj.json" with {
  type: "json",
}
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

const RUN_TIMEOUT_REPRO =
  process.env.RUN_CM5_SPI_ROUTING_TIMEOUT_REPRO === "1"
const EXPECTED_MAX_RUNTIME_MS = 120_000

test("CM5 dual-SPI input snapshot and optional Pipeline 7 timeout repro", () => {
  const srj = structuredClone(simpleRouteJson) as SimpleRouteJson
  const solver = new AutoroutingPipelineSolver7_MultiGraph(srj, {
    cacheProvider: null,
    effort: 1,
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
  expect(elapsedMs).toBeLessThan(EXPECTED_MAX_RUNTIME_MS)
})
