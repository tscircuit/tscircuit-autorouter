import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9RegionalFallbackSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalFallbackSolver"

test("RVboy regional via repair uses physical clearance at legal fixed endpoints", (): void => {
  const { params } = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/rvboy-regional-planning-margin.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString(),
  )
  const planningMarginSolver = new Pipeline9RegionalFallbackSolver({
    ...params,
    connMap: new ConnectivityMap(params.connMap),
    movablePreloadedConnectionNames: new Set(
      params.movablePreloadedConnectionNames,
    ),
  })
  planningMarginSolver.solve()
  expect(planningMarginSolver.failed).toBe(true)
  expect(planningMarginSolver.viaClearanceSolver?.stats.pathSearchNodes).toBe(0)

  const solver = new Pipeline9RegionalFallbackSolver({
    ...params,
    traceToPadClearance: 0.1,
    connMap: new ConnectivityMap(params.connMap),
    movablePreloadedConnectionNames: new Set(
      params.movablePreloadedConnectionNames,
    ),
  })
  solver.solve()
  expect(solver.solved, solver.error ?? "").toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.viaClearanceSolver?.stats.pathSearchNodes).toBeGreaterThan(0)
  expect(solver.viaClearanceSolver?.getOutput().unresolvedSpanCount).toBe(0)
  const viaObstacle = params.boardObstacles.find(
    (obstacle: { obstacleId?: string }) =>
      obstacle.obstacleId?.startsWith("escape-via-obstacle:"),
  )
  for (const route of solver.getOutput()) {
    for (const via of route.vias) {
      const gap =
        Math.hypot(
          Math.max(
            Math.abs(via.x - viaObstacle.center.x) - viaObstacle.width / 2,
            0,
          ),
          Math.max(
            Math.abs(via.y - viaObstacle.center.y) - viaObstacle.height / 2,
            0,
          ),
        ) -
        route.viaDiameter / 2
      expect(gap).toBeGreaterThanOrEqual(params.viaToPadClearance)
    }
  }
})
