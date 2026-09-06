import type { AnyCircuitElement } from "circuit-json"
import {
  type ConnectivityMap,
  getFullConnectivityMapFromCircuitJson,
} from "circuit-json-to-connectivity-map"

export type PreparedDrcConnectivityMapStats = {
  constructionCount: number
  cacheHitCount: number
}

export type PreparedDrcConnectivityMap = {
  (
    circuitJson: AnyCircuitElement[],
    viaOwnerConnections: Iterable<readonly [string, string]>,
  ): ConnectivityMap
  getStats: () => Readonly<PreparedDrcConnectivityMapStats>
}

const getDrcConnectivityKey = (
  circuitJson: AnyCircuitElement[],
  viaOwnerConnections: string[][],
): string => {
  // These are all connectivity declarations read by the pinned 0.0.19
  // converter. Geometry and route endpoint tags are not dependencies. Keep
  // declaration and source-array order: they determine generated net labels.
  const declarations = circuitJson.flatMap((element): unknown[][] => {
    switch (element.type) {
      case "source_trace":
        return [
          [
            element.type,
            element.source_trace_id,
            element.connected_source_port_ids,
            element.connected_source_net_ids,
          ],
        ]
      case "pcb_port":
        return [[element.type, element.pcb_port_id, element.source_port_id]]
      case "pcb_smtpad":
        return [[element.type, element.pcb_smtpad_id, element.pcb_port_id]]
      case "pcb_plated_hole":
        return [
          [element.type, element.pcb_plated_hole_id, element.pcb_port_id],
        ]
      case "pcb_trace":
        return [[element.type, element.pcb_trace_id, element.source_trace_id]]
      default:
        return []
    }
  })
  return JSON.stringify(
    { declarations, viaOwnerConnections },
    (_key: string, value: unknown): unknown => {
      // Preserve opaque strings and numeric distinctions without introducing
      // a validation or normalization rule beyond the native constructor.
      if (typeof value === "number") {
        return `number:${Object.is(value, -0) ? "-0" : String(value)}`
      }
      if (typeof value === "string") return `string:${value}`
      if (value === undefined) return "undefined:"
      if (value === null) return "null:"
      return value
    },
  )
}

/** Reuses one exact map; consumers must treat published maps as read-only. */
export const createPreparedDrcConnectivityMap =
  (): PreparedDrcConnectivityMap => {
    let cached: { key: string; connMap: ConnectivityMap } | undefined
    const stats: PreparedDrcConnectivityMapStats = {
      constructionCount: 0,
      cacheHitCount: 0,
    }
    return Object.assign(
      (
        circuitJson: AnyCircuitElement[],
        viaOwnerConnections: Iterable<readonly [string, string]>,
      ): ConnectivityMap => {
        const orderedViaOwnerConnections = Array.from(
          viaOwnerConnections,
          ([viaId, traceId]): string[] => [viaId, traceId],
        )
        const key = getDrcConnectivityKey(
          circuitJson,
          orderedViaOwnerConnections,
        )
        if (cached?.key === key) {
          stats.cacheHitCount++
          return cached.connMap
        }
        const connMap = getFullConnectivityMapFromCircuitJson(circuitJson)
        // Snapshot callers pass Map entries; full DRC passes every via pair.
        // Preserve either caller's exact order and duplicate semantics.
        connMap.addConnections(orderedViaOwnerConnections)
        cached = { key, connMap }
        stats.constructionCount++
        return connMap
      },
      {
        getStats: (): Readonly<PreparedDrcConnectivityMapStats> => ({
          ...stats,
        }),
      },
    )
  }
