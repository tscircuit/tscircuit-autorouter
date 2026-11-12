import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { Pipeline9HighDensitySolverParams } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import type { SimpleRouteJson } from "lib/types"
import type { CapacityMeshNodeId } from "lib/types/capacity-mesh-types"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

type SerializedRegion = {
  input: Omit<Pipeline9HighDensitySolverParams, "connMap" | "nodePfById">
  netMap: ConnectivityMap["netMap"]
  nodePfById: [CapacityMeshNodeId, number | null][]
  acceptedRoutes: HighDensityIntraNodeRoute[]
  srjWithPointPairs: SimpleRouteJson
}

export type H616PortfolioRegionFixture = {
  input: Pipeline9HighDensitySolverParams
  acceptedRoutes: HighDensityIntraNodeRoute[]
  srjWithPointPairs: SimpleRouteJson
}

export const getH616PortfolioRegionFixture = (
  url: URL,
): H616PortfolioRegionFixture => {
  const fixture = JSON.parse(
    gunzipSync(new Uint8Array(readFileSync(url))).toString("utf8"),
  ) as SerializedRegion
  return {
    input: {
      ...fixture.input,
      connMap: new ConnectivityMap(fixture.netMap),
      nodePfById: new Map(fixture.nodePfById),
    },
    acceptedRoutes: fixture.acceptedRoutes,
    srjWithPointPairs: fixture.srjWithPointPairs,
  }
}
