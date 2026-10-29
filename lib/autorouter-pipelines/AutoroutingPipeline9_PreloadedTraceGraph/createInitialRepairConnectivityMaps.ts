import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { CircuitJsonConnectivityMaps } from "lib/testing/utils/convertToCircuitJson"
import { getSrjWithImportedPadPortIds } from "lib/testing/utils/getSrjWithImportedPadPortIds"
import type { SimpleRouteJson } from "lib/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

export type InitialRepairConnectivityStats = {
  extraNormalizationCalls: number
  sourceMapBuilds: number
  routeMapBuilds: number
  sourceMapReuses: number
  routeMapReuses: number
}

/** Private maps for the two initial native conversions of immutable JSON SRJs. */
export function createInitialRepairConnectivityMaps(
  inputSrjWithPointPairs: SimpleRouteJson,
  inputOriginalSrj: SimpleRouteJson,
  stats: InitialRepairConnectivityStats,
): CircuitJsonConnectivityMaps {
  let normalized: readonly [SimpleRouteJson, SimpleRouteJson] | undefined
  let sourceMap: ConnectivityMap | undefined
  let routeMap: ConnectivityMap | undefined
  const getNormalized = (): readonly [SimpleRouteJson, SimpleRouteJson] => {
    if (normalized !== undefined) return normalized
    // Native conversion normalizes separately even when the raw objects match.
    normalized = [
      getSrjWithImportedPadPortIds(inputSrjWithPointPairs),
      getSrjWithImportedPadPortIds(inputOriginalSrj),
    ]
    stats.extraNormalizationCalls += 2
    return normalized
  }
  return {
    get source(): ConnectivityMap {
      if (sourceMap !== undefined) {
        stats.sourceMapReuses += 1
        return sourceMap
      }
      const [srj, originalSrj] = getNormalized()
      sourceMap = getConnectivityMapFromSimpleRouteJson(originalSrj === srj
        ? srj
        : { ...originalSrj, connections: [...srj.connections, ...originalSrj.connections] })
      stats.sourceMapBuilds += 1
      return sourceMap
    },
    get route(): ConnectivityMap {
      if (routeMap !== undefined) {
        stats.routeMapReuses += 1
        return routeMap
      }
      // This getter is reached after native source/port/pad/via generation.
      routeMap = getConnectivityMapFromSimpleRouteJson(getNormalized()[0])
      stats.routeMapBuilds += 1
      return routeMap
    },
  }
}
