import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { createPipeline9AutoroutingDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9AutoroutingDrcEvaluator"
import type { SimpleRouteJson } from "lib/types"

type ViaPadViolation = {
  connectionName: string
  padId: string | undefined
  gap: number
  required: number
}

test("Pipeline9 solves QSPI phase without via-to-unrelated-pad overlap or clearance violations (#2654)", (): void => {
  const input: SimpleRouteJson = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/assets/qspi-via-pad-overlap-2654.srj.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString("utf8"),
  )
  const requiredViaPadClearance: number =
    input.minViaEdgeToPadEdgeClearance ?? 0
  const defaultViaPadDiameter: number =
    input.minViaPadDiameter ?? input.minViaDiameter ?? 0.45

  const sclkPad = input.obstacles.find(
    (obstacle) =>
      obstacle.circuitJsonMetadata?.pcb_smtpad_id === "pcb_smtpad_87",
  )
  expect(sclkPad).toBeDefined()
  expect(sclkPad!.connectedTo).toContain("source_trace_34")
  expect(sclkPad!.connectedTo).not.toContain("source_trace_30")

  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(input),
    { cacheProvider: null },
  )
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.error).toBeNull()

  const traces = solver.getOutputSimplifiedPcbTraces()
  const violations: ViaPadViolation[] = []

  for (const trace of traces) {
    for (const point of trace.route) {
      if (point.route_type !== "via") continue
      const viaDiameter = point.via_diameter ?? defaultViaPadDiameter
      for (const obstacle of input.obstacles) {
        if (obstacle.connectedTo.includes(trace.connection_name)) continue
        const sharesLayer =
          input.allowBlindAndBuriedVias !== true ||
          obstacle.layers.includes(point.from_layer) ||
          obstacle.layers.includes(point.to_layer)
        if (!sharesLayer) continue
        const dx = Math.max(
          Math.abs(point.x - obstacle.center.x) - obstacle.width / 2,
          0,
        )
        const dy = Math.max(
          Math.abs(point.y - obstacle.center.y) - obstacle.height / 2,
          0,
        )
        const gap = Math.hypot(dx, dy) - viaDiameter / 2
        if (gap < requiredViaPadClearance - 1e-6) {
          violations.push({
            connectionName: trace.connection_name,
            padId:
              obstacle.circuitJsonMetadata?.pcb_smtpad_id ??
              obstacle.obstacleId,
            gap,
            required: requiredViaPadClearance,
          })
        }
      }
    }
  }

  expect(violations).toEqual([])

  const evaluateDrc = createPipeline9AutoroutingDrcEvaluator({
    inputSrj: input,
    srjWithPointPairs: solver.srjWithPointPairs!,
    includeBoardClearance: true,
    drcOptions: {
      traceClearance: input.minTraceToPadEdgeClearance,
      viaClearance: input.minViaHoleEdgeToViaHoleEdgeClearance,
    },
  })
  expect(evaluateDrc(traces).errors).toEqual([])
})
