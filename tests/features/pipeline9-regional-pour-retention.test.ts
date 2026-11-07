import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { getFixedObstacleViolations } from "@tscircuit/repair04"
import { Pipeline9RegionalFallbackSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalFallbackSolver"

test("RVboy regional repair retains pour layers and rejects an unrepairable foreign wire", (): void => {
  const { params, routes } = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/rvboy-regional-foreign-pour.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString(),
  )
  const foreign = routes.filter(
    (route: { connectionName: string }) =>
      route.connectionName === "source_net_2_mst3",
  )
  expect(foreign).toHaveLength(1)
  const violations = getFixedObstacleViolations({
    srj: {
      ...params.boardGeometry,
      layerCount: params.layerCount,
      minTraceWidth: params.traceWidth,
      obstacles: params.obstacles.filter(
        (obstacle: { isCopperPour?: boolean }) => obstacle.isCopperPour,
      ),
      connections: [],
    },
    routes: foreign,
    traceClearance: 0.1,
  })
  expect(violations.some((violation) => violation.kind === "wire")).toBe(true)
  const solver = new Pipeline9RegionalFallbackSolver({
    ...params,
    connMap: new ConnectivityMap(params.connMap),
    movablePreloadedConnectionNames: new Set(
      params.movablePreloadedConnectionNames,
    ),
  })
  solver.solve()
  // The captured boundary anchors cannot fit beside retained copper. Keep the
  // failure visible instead of publishing a detour through the ground plane.
  expect(solver.failed).toBe(true)
  expect(solver.solved).toBe(false)
  expect(solver.error).toContain("candidate validator")
  expect(solver.stats.pourWireCandidateRejectionCount).toBeGreaterThan(0)
  expect(() => solver.getOutput()).toThrow()
})
