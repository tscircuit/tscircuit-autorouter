import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  Pipeline9RegionalFallbackSolver,
  hasViaToBoardObstacleConflict,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalFallbackSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

type Params = ConstructorParameters<typeof Pipeline9RegionalFallbackSolver>[0]
type Capture = {
  params: Omit<
    Params,
    "connMap" | "nodePfById" | "movablePreloadedConnectionNames"
  > & {
    connMap: Record<string, string[]>
    nodePfById: Record<string, number | null>
    movablePreloadedConnectionNames: string[]
  }
  initialRoutes: HighDensityRoute[]
}

test("SRJ18 sample 6 repairs its complete native candidate without routing the region again", (): void => {
  const capture = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/srj18-sample6-regional-candidate.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString(),
  ) as Capture
  const original = structuredClone(capture)
  const params: Params = {
    ...capture.params,
    // The complete benchmark applies this default in its final DRC. Specify
    // it explicitly when checking the regional repair stage in isolation.
    viaToPadClearance: 0.1,
    initialRoutes: capture.initialRoutes,
    connMap: new ConnectivityMap(capture.params.connMap),
    nodePfById: new Map(Object.entries(capture.params.nodePfById)),
    movablePreloadedConnectionNames: new Set(
      capture.params.movablePreloadedConnectionNames,
    ),
  }
  expect(
    hasViaToBoardObstacleConflict({
      ...params,
      routes: capture.initialRoutes,
      boardObstacles: params.boardObstacles!,
      viaToPadClearance: 0.1,
    }),
  ).toBe(true)
  const solver = new Pipeline9RegionalFallbackSolver(params)
  expect(() => solver.getOutput()).toThrow()
  solver.solve()
  expect(solver.failed, solver.error ?? "").toBe(false)
  expect(solver.solved).toBe(true)
  expect(solver.highDensitySolver.iterations).toBe(0)
  expect(solver.forceImproveSolver?.solved).toBe(true)
  expect(solver.repairSolver?.solved).toBe(true)
  const routes = solver.getOutput()
  expect(routes).toHaveLength(capture.initialRoutes.length)
  const endpoints = (paths: HighDensityRoute[]): string[] =>
    paths
      .map((route) =>
        JSON.stringify({
          connectionName: route.connectionName,
          points: [route.route[0]!, route.route.at(-1)!]
            .map(({ x, y, z }) => JSON.stringify({ x, y, z }))
            .sort(),
        }),
      )
      .sort()
  expect(endpoints(routes)).toEqual(endpoints(capture.initialRoutes))
  expect(
    hasViaToBoardObstacleConflict({
      ...params,
      routes,
      boardObstacles: params.boardObstacles!,
      viaToPadClearance: 0.1,
    }),
  ).toBe(false)
  expect(capture).toEqual(original)
})
