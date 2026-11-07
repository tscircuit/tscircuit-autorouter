import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9RegionalFallbackSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalFallbackSolver"

test("RVboy regional clearance repair moves a preloaded via away from a solid ground pad", (): void => {
  const { params } = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/rvboy-preloaded-via-repair.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString(),
  )
  const solver = new Pipeline9RegionalFallbackSolver({
    ...params,
    viaHoleDiameter: 0.2,
    minViaHoleEdgeToViaHoleEdgeClearance: 0.2,
    connMap: new ConnectivityMap(params.connMap),
    movablePreloadedConnectionNames: new Set(
      params.movablePreloadedConnectionNames,
    ),
  })
  solver.solve()
  expect(solver.solved, solver.error ?? "").toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.viaClearanceSolver?.stats.pathSearchNodes).toBeGreaterThan(0)
  const route = solver
    .getOutput()
    .find((route) => route.connectionName === "source_trace_122_fixed_30_8")!
  const pad = params.boardObstacles.find(
    (obstacle: { circuitJsonMetadata?: { pcb_smtpad_id?: string } }) =>
      obstacle.circuitJsonMetadata?.pcb_smtpad_id === "pcb_smtpad_58",
  )
  for (const via of route.vias) {
    const gap =
      Math.hypot(
        Math.max(Math.abs(via.x - pad.center.x) - pad.width / 2, 0),
        Math.max(Math.abs(via.y - pad.center.y) - pad.height / 2, 0),
      ) -
      route.viaDiameter / 2
    expect(gap).toBeGreaterThanOrEqual(params.viaToPadClearance)
  }
})
