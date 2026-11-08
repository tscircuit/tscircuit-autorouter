import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph as Pipeline } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { Pipeline9NegotiatedClearanceSolver as Solver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9NegotiatedClearanceSolver"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { assignUniquePcbTraceIdsToNewTraces } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/assignUniquePcbTraceIdsToNewTraces"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { renderPlanarShortcutView } from "../fixtures/renderPlanarShortcutView"

type Capture = {
  originalSrj: SimpleRouteJson
  srj: SimpleRouteJson
  routes: HighDensityRoute[]
  preloaded: SimplifiedPcbTraces
  connMap: Record<string, string[]>
  newConnections: SimpleRouteJson["connections"]
}

test("RVboy negotiation reserves the drills of ground-plane terminal vias", async (): Promise<void> => {
  // Exact native negotiation checkpoint. Only the rendered viewport is cropped.
  const capture = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/rvboy-terminal-via-drill-negotiation.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString(),
  ) as Capture
  const original = JSON.stringify(capture)
  const connMap = new ConnectivityMap(capture.connMap)
  const pipeline = new Pipeline(capture.originalSrj, { effort: 5 })
  Object.assign(pipeline, {
    srj: capture.srj,
    srjWithPointPairs: capture.srj,
    connMap,
    getUpdatedPreloadedTraces: (): SimplifiedPcbTraces => capture.preloaded,
    pipeline9JointDrcRepairSolver: {
      getOutput: (): HighDensityRoute[] => capture.routes,
    },
    netToPointPairsSolver: { newConnections: capture.newConnections },
  })
  const stage = pipeline.pipelineDef.find(
    (step) => step.solverName === "negotiatedClearanceSolver",
  )!
  const params = stage.getConstructorParams(
    pipeline,
  )[0] as ConstructorParameters<typeof Solver>[0]
  expect(params.evaluate(capture.routes, capture.preloaded).errorCount).toBe(9)
  const solver = new Solver(params)
  solver.solve()
  expect(solver.failed, solver.error ?? "").toBeFalse()
  expect(solver.bestErrorCount).toBe(0)
  const afterRoutes = solver.getOutput()
  const afterPreloaded = solver.getUpdatedPreloadedTraces()
  expect(params.evaluate(afterRoutes, afterPreloaded).errorCount).toBe(0)
  for (const [index, trace] of capture.preloaded.entries()) {
    if (trace.isFixed) expect(afterPreloaded[index]).toEqual(trace)
  }
  expect(JSON.stringify(capture)).toBe(original)

  for (const [state, routes, preloaded] of [
    ["before", capture.routes, capture.preloaded],
    ["after", afterRoutes, afterPreloaded],
  ] as const) {
    const traces = assignUniquePcbTraceIdsToNewTraces(
      convertPipeline7HdRoutesToSimplifiedPcbTraces({
        connections: capture.newConnections,
        originalConnections: capture.originalSrj.connections,
        hdRoutes: routes,
        layerCount: capture.srj.layerCount,
        obstacles: capture.srj.obstacles,
        defaultViaHoleDiameter: 0.2,
        connMap,
      }),
      capture.originalSrj.traces ?? [],
    )
    const graphics = convertSrjToGraphicsObject({
      ...capture.originalSrj,
      connections: [],
      obstacles: capture.originalSrj.obstacles.filter(
        (obstacle) => !obstacle.isCopperPour,
      ),
      traces: [...preloaded, ...traces],
    })
    // The ring is the required 0.6 mm center distance for two 0.2 mm drills
    // with the board's 0.4 mm drill-edge clearance.
    graphics.circles ??= []
    graphics.circles.push({
      center: { x: 9.355, y: 12.85 },
      radius: 0.6,
      fill: "none",
      stroke: "#475569",
    })
    const selected = traces.filter((trace) =>
      ["source_net_70", "source_net_68"].includes(trace.connection_name),
    )
    for (const trace of selected) {
      for (const point of trace.route) {
        if (point.route_type !== "via") continue
        graphics.circles.push({
          center: point,
          radius: 0.1,
          fill: state === "before" ? "#dc2626" : "#15803d",
          stroke: "none",
        })
      }
    }
    await expect(
      renderPlanarShortcutView(graphics, {
        minX: 8.6,
        maxX: 10.7,
        minY: 12.1,
        maxY: 14.3,
      }),
    ).toMatchSvgSnapshot(import.meta.path, { svgName: state })
  }
})
