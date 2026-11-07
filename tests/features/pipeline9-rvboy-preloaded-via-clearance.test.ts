import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9RegionalFallbackSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalFallbackSolver"

test("RVboy regional clearance repair rejects a signal terminal inside the ground plane", (): void => {
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
  // This older capture has a signal terminal on inner1, inside the ground
  // pour. Moving its via away from the top pad cannot make that terminal legal.
  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
  expect(solver.error).toBe(
    "Pipeline9 regional repair output failed its candidate validator",
  )
  expect(solver.stats.pourWireCandidateRejectionCount).toBeGreaterThan(0)
  expect(solver.viaClearanceSolver?.stats.pathSearchNodes).toBeGreaterThan(0)
  expect(() => solver.getOutput()).toThrow(
    "Cannot publish regional routes before final validation",
  )
})
