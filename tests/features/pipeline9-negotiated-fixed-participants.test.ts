import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { Pipeline9NegotiatedClearanceSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9NegotiatedClearanceSolver"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

type Capture = {
  originalSrj: SimpleRouteJson
  srj: SimpleRouteJson
  srjWithPointPairs: SimpleRouteJson
  routes: HighDensityRoute[]
  preloaded: SimplifiedPcbTraces
  connMap: Record<string, string[]>
  newConnections: SimpleRouteJson["connections"]
}

test("negotiated clearance queues the movable participant when a retained trace is named first", (): void => {
  const capture = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/rvboy-negotiated-fixed-participants.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString(),
  ) as Capture
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    capture.originalSrj,
  )
  Object.assign(pipeline, {
    srj: capture.srj,
    srjWithPointPairs: capture.srjWithPointPairs,
    connMap: new ConnectivityMap(capture.connMap),
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
  )[0] as ConstructorParameters<typeof Pipeline9NegotiatedClearanceSolver>[0]
  const result = params.evaluate(capture.routes, capture.preloaded)
  expect(result.errorCount).toBe(15)
  // These actual collisions encode the second ID in pcb_trace_error_id.
  // The primary ID belongs to retained copper, so it cannot identify this route.
  const collidingMovableConnections = [
    "source_net_94_mst0",
    "source_trace_7__source_net_15",
    "source_trace_4__source_net_40_mst2",
    "source_trace_121__source_trace_122__source_trace_134__source_trace_135__source_trace_136__source_net_0_mst58",
    "source_trace_121__source_trace_122__source_trace_134__source_trace_135__source_trace_136__source_net_0_mst59",
  ]
  for (const name of collidingMovableConnections) {
    const index = capture.routes.findIndex(
      (route) => route.connectionName === name,
    )
    expect(index).toBeGreaterThanOrEqual(0)
    expect(result.dirtyRouteIndices).toContain(index)
  }
})
