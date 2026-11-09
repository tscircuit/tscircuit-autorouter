import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import {
  Pipeline9RegionalFallbackSolver,
  hasViaToBoardObstacleConflict,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalFallbackSolver"
import {
  arePipeline9RoutesOnSameNet,
  doPipeline9RoutesHaveCopperConflict,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { renderRvboyRoutingView } from "../../fixtures/bug-reports/rvboy-escape-via-span/renderRvboyRoutingView"

type RegionalParams = ConstructorParameters<
  typeof Pipeline9RegionalFallbackSolver
>[0]
type CapturedParams = Omit<
  RegionalParams,
  "connMap" | "movablePreloadedConnectionNames"
> & {
  connMap: Record<string, string[]>
  movablePreloadedConnectionNames: string[]
}

test("RVboy regional clearance search honors requested effort without changing its geometry", async (): Promise<void> => {
  // The complete captured SRJ and regional input are retained. Only rendering is cropped.
  const fixture = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/rvboy-regional-clearance-effort.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString(),
  ) as { input: SimpleRouteJson; params: CapturedParams }
  const params: RegionalParams = {
    ...fixture.params,
    connMap: new ConnectivityMap(fixture.params.connMap),
    movablePreloadedConnectionNames: new Set(
      fixture.params.movablePreloadedConnectionNames,
    ),
  }
  const originalFixed = structuredClone(params.fixedRoutes!)
  const baseline = new Pipeline9RegionalFallbackSolver(params)
  baseline.solve()
  expect(baseline.failed).toBe(true)
  expect(baseline.error).toBe(
    "Pipeline9 regional repair output failed its candidate validator",
  )
  expect(baseline.viaClearanceSolver!.stats.pathSearchNodes).toBe(1_000_000)
  const candidate = baseline.repairSolver!.getOutput()
  const before = baseline
    .viaClearanceSolver!.getOutput()
    .routes.slice(0, candidate.length)
    .map((route, index) => ({
      ...route,
      rootConnectionName: candidate[index]!.rootConnectionName,
    }))

  const solver = new Pipeline9RegionalFallbackSolver({
    ...params,
    clearanceRepairEffort: 5,
  })
  solver.solve()
  expect(solver.solved, solver.error ?? "").toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.repairSolver!.getOutput()).toEqual(candidate)
  expect(solver.viaClearanceSolver!.input.maxPathSearchNodes).toBe(5_000_000)
  expect(solver.viaClearanceSolver!.stats.pathSearchNodes).toBeGreaterThan(
    1_000_000,
  )
  const after = solver.getOutput()
  const conflicts = (routes: HighDensityRoute[]): boolean =>
    routes.some((route) =>
      originalFixed.some(
        (fixed) =>
          !arePipeline9RoutesOnSameNet(route, fixed, params.connMap) &&
          doPipeline9RoutesHaveCopperConflict({
            left: route,
            right: fixed,
            clearance: 0.1,
            layerCount: params.layerCount,
            allowBlindAndBuriedVias: params.allowBlindAndBuriedVias,
          }),
      ),
    )
  expect(conflicts(before)).toBe(true)
  expect(conflicts(after)).toBe(false)
  expect(
    hasViaToBoardObstacleConflict({
      routes: after,
      boardObstacles: params.boardObstacles!,
      connMap: params.connMap,
      layerCount: params.layerCount,
      allowBlindAndBuriedVias: params.allowBlindAndBuriedVias,
      viaToPadClearance: params.viaToPadClearance!,
    }),
  ).toBe(false)
  expect(params.fixedRoutes).toEqual(originalFixed)
  expect(
    solver
      .viaClearanceSolver!.getOutput()
      .routes.slice(after.length)
      .map((route) => route.route),
  ).toEqual(originalFixed.map((route) => route.route))
  for (const [index, route] of after.entries()) {
    expect(route.route[0]).toEqual(candidate[index]!.route[0])
    expect(route.route.at(-1)).toEqual(candidate[index]!.route.at(-1))
  }

  // Exercise the pipeline option at its public boundary as well as the captured regional solve.
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    {
      bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
      layerCount: 2,
      minTraceWidth: 0.1,
      obstacles: [],
      connections: [
        {
          name: "signal",
          pointsToConnect: [
            { x: -1, y: 0, layer: "top" },
            { x: 1, y: 0, layer: "top" },
          ],
        },
      ],
    },
    { effort: 5, cacheProvider: null },
  )
  while (
    !pipeline.highDensityRouteSolver &&
    !pipeline.solved &&
    !pipeline.failed
  )
    pipeline.step()
  expect(pipeline.failed, pipeline.error ?? "").toBe(false)
  expect(pipeline.highDensityRouteSolver!["params"].effort).toBe(1)
  expect(pipeline.highDensityRouteSolver!["params"].clearanceRepairEffort).toBe(
    5,
  )

  // Remaining regional trace-to-trace cleanup belongs to the subsequent full-board stages.
  // This check proves clearance from unchanged copper and pads, not final fabrication DRC.
  for (const [name, routes] of [
    ["before", before],
    ["after", after],
  ] as const) {
    const graphics = convertSrjToGraphicsObject({
      ...fixture.input,
      traces: [
        ...fixture.input.traces!,
        ...routes.map((route) => ({
          type: "pcb_trace" as const,
          pcb_trace_id: route.connectionName,
          connection_name: route.connectionName,
          route: convertHdRouteToSimplifiedRoute(route, params.layerCount),
        })),
      ],
    })
    // Hide enlarged logical endpoint markers; physical pads, vias, and traces remain.
    graphics.points = []
    await expect(
      renderRvboyRoutingView(
        graphics,
        { minX: 5.7, maxX: 8.5, minY: 15, maxY: 22 },
        "RVboy: requested clearance repair effort",
        name === "before"
          ? "1x: search budget exhausted; pad and retained-copper conflicts"
          : "5x: regional routes clear pads and retained copper",
      ),
    ).toMatchSvgSnapshot(import.meta.path, { svgName: name })
  }
})
