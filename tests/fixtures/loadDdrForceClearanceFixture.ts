import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"

export type DdrForceClearanceFixture = {
  inputSrj: SimpleRouteJson
  srjWithPointPairs: SimpleRouteJson
  hdRoutes: HighDensityRoute[]
  nodeWithPortPoints: NodeWithPortPoints[]
  preloadedConnections: SimpleRouteJson["connections"]
  preloadedTraces: SimplifiedPcbTrace[]
  nativeObstacles: SimpleRouteJson["obstacles"]
}

export function loadDdrForceClearanceFixture(): DdrForceClearanceFixture {
  const fixtureUrl = new URL(
    "./assets/ddr-force-clearance.json.gz",
    import.meta.url,
  )
  return JSON.parse(
    gunzipSync(new Uint8Array(readFileSync(fixtureUrl))).toString("utf8"),
  ) as DdrForceClearanceFixture
}
