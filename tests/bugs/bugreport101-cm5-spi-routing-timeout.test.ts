import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib"
import type { SimpleRouteJson } from "lib/types"
import simpleRouteJson from "../../public/fixtures/bugreport101-cm5-spi-routing-timeout.srj.json" with {
  type: "json",
}
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

const EXPECTED_MAX_RUNTIME_MS = 120_000

test("bugreport101 routes the CM5 dual-SPI breakout with B02", () => {
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

  const startedAt = performance.now()
  solver.solve()
  const elapsedMs = performance.now() - startedAt
  const solverNodeCount = solver.highDensityRouteSolver?.stats
    .solverNodeCount as Record<string, number> | undefined

  console.info(
    JSON.stringify(
      {
        elapsedMs: Math.round(elapsedMs),
        iterations: solver.iterations,
        solverNodeCount,
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
  expect(solverNodeCount?.HighDensitySolverB02 ?? 0).toBeGreaterThan(0)
  expect(elapsedMs).toBeLessThan(EXPECTED_MAX_RUNTIME_MS)
})
