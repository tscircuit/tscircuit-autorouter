import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { createPipeline9AutoroutingDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9AutoroutingDrcEvaluator"
import { preparePipeline9DrcRoutedTracesWithMetadata } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/preparePipeline9DrcRoutedTraces"
import { createPipeline7HdRoutesToSimplifiedPcbTracesConverter } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { combinePreloadedAndRoutedTraces } from "lib/utils/combinePreloadedAndRoutedTraces"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { renderRvboyRoutingView } from "../../fixtures/bug-reports/rvboy-escape-via-span/renderRvboyRoutingView"
import type { SimplifiedPcbTrace } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("RVboy joint repair counts foreign pour wires on every indexed candidate", async (): Promise<void> => {
  const fixture = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/rvboy-vsys-joint-pour-ranking.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString(),
  )
  const params = {
    ...fixture.params,
    connMap: new ConnectivityMap(fixture.params.connMap),
    mutatedPreloadedTraceIds: new Set<string>(
      fixture.params.mutatedPreloadedTraceIds,
    ),
  }
  const solver = new Pipeline9JointDrcRepairSolver(params)
  solver.solve()
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  const convert = createPipeline7HdRoutesToSimplifiedPcbTracesConverter({
    connections: params.newConnections,
    originalConnections: params.originalSrj.connections,
    layerCount: params.layerCount,
    obstacles: params.obstacles,
    defaultViaHoleDiameter: params.defaultViaHoleDiameter,
    connMap: params.connMap,
  })
  const evaluate = createPipeline9AutoroutingDrcEvaluator({
    inputSrj: params.originalSrj,
    srjWithPointPairs: params.srjWithPointPairs,
    includeBoardClearance: true,
    drcOptions: { traceClearance: 0.1, viaClearance: 0.2 },
  })
  const cases: Array<{
    name: string
    routes: HighDensityRoute[]
    preloadedTraces: SimplifiedPcbTrace[]
  }> = [
    { name: "before", ...fixture.before },
    {
      name: "after",
      routes: solver.getOutput(),
      preloadedTraces: solver.getUpdatedPreloadedTraces(),
    },
  ]
  // Keep the full captured solver input. Crop only the drawing around the
  // battery-to-switch crossing where the previous repair used the ground layer.
  const viewbox = { minX: -33, maxX: -27.5, minY: 0.5, maxY: 6.5 }
  for (const scenario of cases) {
    const traces = preparePipeline9DrcRoutedTracesWithMetadata({
      originalPreloadedTraces: params.originalSrj.traces,
      mutatedPreloadedTraces: scenario.preloadedTraces,
      newTraces: convert(scenario.routes),
    }).routedTraces
    const { errors } = evaluate(traces)
    const foreignPourErrors = errors.filter((error) =>
      String(error.pcb_trace_error_id).startsWith("pour_wire_"),
    )
    if (scenario.name === "before") {
      expect(foreignPourErrors.length).toBeGreaterThan(0)
    } else {
      expect(errors).toEqual([])
    }
    const graphics = convertSrjToGraphicsObject(
      {
        ...params.originalSrj,
        // Pour rectangles cover the drawing; their constraints remain in the input and evaluator.
        obstacles: params.originalSrj.obstacles.filter(
          (obstacle: { isCopperPour?: boolean }) => !obstacle.isCopperPour,
        ),
        traces: combinePreloadedAndRoutedTraces(
          params.originalSrj.traces,
          traces,
        ),
      },
      { traceColorMode: "layer" },
    )
    await expect(
      renderRvboyRoutingView(
        graphics,
        viewbox,
        "RVboy: supply repair at the ground plane",
        `${scenario.name === "before" ? "Before" : "After"}: ${foreignPourErrors.length} foreign-pour violations; ${errors.length} total DRC errors`,
      ),
    ).toMatchSvgSnapshot(import.meta.path, { svgName: scenario.name })
  }
})
