import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { getFixedObstacleViolations } from "@tscircuit/repair04"
import { Pipeline9RegionalFallbackSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalFallbackSolver"

test("RVboy regional routing avoids a fully covered foreign pour layer", (): void => {
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
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  expect(solver.params.nodeWithPortPoints.availableZ).not.toContain(1)
  const outputViolations = getFixedObstacleViolations({
    srj: {
      ...params.boardGeometry,
      layerCount: params.layerCount,
      minTraceWidth: params.traceWidth,
      obstacles: params.obstacles.filter(
        (obstacle: { isCopperPour?: boolean }) => obstacle.isCopperPour,
      ),
      connections: [],
    },
    routes: solver.getOutput(),
    traceClearance: 0.1,
  })
  expect(
    outputViolations.filter((violation) => violation.kind === "wire"),
  ).toEqual([])
})
