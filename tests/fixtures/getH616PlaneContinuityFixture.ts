import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { createPipeline7HdRoutesToSimplifiedPcbTracesConverter } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import type { EvaluateRelaxedDrcInput } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

export function getH616PlaneContinuityFixture(): EvaluateRelaxedDrcInput {
  const fixture = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../repro/assets/h616-plane-continuity.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString("utf8"),
  ) as {
    inputSrj: SimpleRouteJson
    srjWithPointPairs: SimpleRouteJson
    hdRoutes: HighDensityRoute[]
  }
  const convert = createPipeline7HdRoutesToSimplifiedPcbTracesConverter({
    connections: fixture.srjWithPointPairs.connections,
    originalConnections: fixture.inputSrj.connections,
    layerCount: fixture.inputSrj.layerCount,
    obstacles: fixture.inputSrj.obstacles,
    defaultViaHoleDiameter: 0.15,
    connMap: getConnectivityMapFromSimpleRouteJson(fixture.srjWithPointPairs),
  })
  return { ...fixture, routedTraces: convert(fixture.hdRoutes) }
}
