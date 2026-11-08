import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9RegionalFallbackSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalFallbackSolver"

test("RVboy regional routing repairs provisional vias before publishing validated copper", (): void => {
  // Complete captured constructor input; only the diagnostic view is cropped.
  const captured = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/rvboy-region-before-repair.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString(),
  )
  const params = captured.params
  const solver = new Pipeline9RegionalFallbackSolver({
    ...params,
    // This historical capture predates the separate physical trace-clearance
    // input. RVboy uses 0.10 mm clearance; its 0.15 mm topology planning margin
    // would incorrectly make two already legal, fixed endpoints unroutable.
    traceToPadClearance: 0.1,
    connMap: new ConnectivityMap(params.connMap),
    movablePreloadedConnectionNames: new Set(
      params.movablePreloadedConnectionNames,
    ),
  })
  expect(() => solver.getOutput()).toThrow("before final validation")
  solver.solve()
  expect(solver.failed, solver.error ?? "").toBe(false)
  expect(solver.solved).toBe(true)
  const routes = solver.getOutput()
  expect(routes.length).toBeGreaterThan(0)
  const target = routes.find(
    (route) => route.connectionName === "source_trace_380_fixed_58_0",
  )!
  expect(target).toBeDefined()
  const pad = params.boardObstacles.find(
    (obstacle: { circuitJsonMetadata?: { pcb_smtpad_id?: string } }) =>
      obstacle.circuitJsonMetadata?.pcb_smtpad_id === "pcb_smtpad_189",
  )
  for (const via of target.vias) {
    const distance = Math.hypot(
      Math.max(Math.abs(via.x - pad.center.x) - pad.width / 2, 0),
      Math.max(Math.abs(via.y - pad.center.y) - pad.height / 2, 0),
    )
    expect(distance - target.viaDiameter / 2).toBeGreaterThanOrEqual(
      params.viaToPadClearance,
    )
  }
})
