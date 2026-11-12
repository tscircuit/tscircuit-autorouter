import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { checkViaPadClearance } from "@tscircuit/checks"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9RegionalFallbackSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalFallbackSolver"
import type { Obstacle, SimpleRouteJson } from "lib/types"
import type { CapacityMeshNodeId } from "lib/types/capacity-mesh-types"
import { convertToCircuitJson } from "lib/utils/convertToCircuitJson"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"

type RegionalInput = ConstructorParameters<
  typeof Pipeline9RegionalFallbackSolver
>[0] & {
  boardObstacles: Obstacle[]
  movablePreloadedConnectionNames: ReadonlySet<string>
  viaToPadClearance: number
}
type RegionalFixture = {
  params: Omit<
    RegionalInput,
    "connMap" | "nodePfById" | "movablePreloadedConnectionNames"
  >
  netMap: ConnectivityMap["netMap"]
  nodePfById: [CapacityMeshNodeId, number | null][]
  movablePreloadedConnectionNames: string[]
  boardRules: Omit<SimpleRouteJson, "obstacles" | "connections" | "traces">
}

export const getRoundPadRegionalFixture = (
  url: URL,
): {
  input: RegionalInput
  srj: SimpleRouteJson
} => {
  const fixture = JSON.parse(
    gunzipSync(new Uint8Array(readFileSync(url))).toString("utf8"),
  ) as RegionalFixture
  const input: RegionalInput = {
    ...fixture.params,
    connMap: new ConnectivityMap(fixture.netMap),
    nodePfById: new Map(fixture.nodePfById),
    movablePreloadedConnectionNames: new Set(
      fixture.movablePreloadedConnectionNames,
    ),
  }
  const srj: SimpleRouteJson = {
    ...fixture.boardRules,
    obstacles: input.boardObstacles,
    connections: input.nodeWithPortPoints.portPointsInPairs!.map(
      ([start, end]) => ({
        name: start.connectionName,
        rootConnectionName: start.rootConnectionName,
        pointsToConnect: [start, end].map((point) => ({
          ...point,
          layer: mapZToLayerName(point.z, input.layerCount),
        })),
      }),
    ),
  }
  return { input, srj }
}

export const getRoundPadRegionalViaPadErrors = ({
  input,
  srj,
  solver,
}: {
  input: RegionalInput
  srj: SimpleRouteJson
  solver: Pipeline9RegionalFallbackSolver
}): ReturnType<typeof checkViaPadClearance> => {
  const preloadedRoutes = solver
    .getOutput()
    .filter((route) =>
      input.movablePreloadedConnectionNames.has(route.connectionName),
    )
  const circuitJson = convertToCircuitJson(srj, preloadedRoutes, {
    minTraceWidth: srj.minTraceWidth,
    minViaDiameter: srj.minViaDiameter,
    minViaHoleDiameter: srj.minViaHoleDiameter,
    connectivityMaps: { source: input.connMap, route: input.connMap },
  })
  return checkViaPadClearance(circuitJson, {
    minClearance: input.viaToPadClearance,
  })
}
