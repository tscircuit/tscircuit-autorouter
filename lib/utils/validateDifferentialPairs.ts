import type { SimpleRouteJson } from "lib/types"
import { DifferentialPairRoutingError } from "./DifferentialPairRoutingError"
import { getConnectionPointLayers } from "./connection-point-utils"
import { getConnectivityMapFromSimpleRouteJson } from "./getConnectivityMapFromSimpleRouteJson"
import {
  getInitiallyConnectedMapFromSimpleRouteJson,
  areIdsInitiallyConnected,
} from "./get-initially-connected-map-from-simple-route-json"

/** Validate the complete, newly routed ownership set before any decomposition. */
export const validateDifferentialPairs = (
  srj: SimpleRouteJson,
): Set<string> => {
  const ownedNames = new Set<string>()
  if (!srj.differentialPairs?.length) return ownedNames
  const connMap = getConnectivityMapFromSimpleRouteJson(srj)
  const initiallyConnected = getInitiallyConnectedMapFromSimpleRouteJson(srj)
  for (const [pairIndex, pair] of (srj.differentialPairs ?? []).entries()) {
    const fail = (
      detail: string,
      connectionName?: string,
      reason:
        | "invalid_differential_pair"
        | "unsupported_routing_scope" = "invalid_differential_pair",
    ): never => {
      throw new DifferentialPairRoutingError(
        {
          reason,
          pairIndex,
          ...(connectionName === undefined ? {} : { connectionName }),
          detail,
        },
        `pair ${pairIndex}: ${detail}`,
      )
    }
    if (!Number.isFinite(pair.maxLengthSkewMm) || pair.maxLengthSkewMm < 0)
      fail("maxLengthSkewMm must be finite and nonnegative")
    if (
      !Array.isArray(pair.connectionNames) ||
      pair.connectionNames.length !== 2
    )
      fail("expected two nonempty copper-hop lists")
    const groups = new Set<string | undefined>()
    const laneNets: [Set<string>, Set<string>] = [new Set(), new Set()]
    for (const [laneIndex, lane] of pair.connectionNames.entries()) {
      if (!Array.isArray(lane) || lane.length === 0)
        fail(`lane ${laneIndex} must be a nonempty copper-hop list`)
      for (const name of lane) {
        if (
          typeof name !== "string" ||
          name.length === 0 ||
          ownedNames.has(name)
        )
          fail(`invalid or repeated owned hop "${name}"`, name)
        ownedNames.add(name)
        const matches = srj.connections.filter(
          (connection): boolean => connection.name === name,
        )
        if (matches.length !== 1)
          fail(
            `hop "${name}" must resolve to exactly one connection in this routing phase`,
            name,
          )
        const connection = matches[0]!
        if (connection.pointsToConnect.length !== 2)
          fail(`hop "${name}" must have exactly two points`, name)
        if (connection.isOffBoard)
          fail(
            `hop "${name}" cannot use off-board copper`,
            name,
            "unsupported_routing_scope",
          )
        groups.add(connection.routingPcbGroupId)
        const endpointIds = connection.pointsToConnect.map(
          (point): string | undefined => point.pointId ?? point.pcb_port_id,
        )
        if (
          endpointIds[0] &&
          endpointIds[1] &&
          areIdsInitiallyConnected(
            initiallyConnected,
            endpointIds[0],
            endpointIds[1],
          )
        )
          fail(
            `hop "${name}" has preserved copper; multi-phase matching is unsupported`,
            name,
            "unsupported_routing_scope",
          )
        if (
          (srj.traces ?? []).some(
            (trace): boolean =>
              trace.connection_name === name ||
              (connection.source_trace_id !== undefined &&
                trace.source_trace_id === connection.source_trace_id),
          )
        )
          fail(
            `hop "${name}" has preserved copper; multi-phase matching is unsupported`,
            name,
            "unsupported_routing_scope",
          )
        for (const point of connection.pointsToConnect) {
          if (
            !Number.isFinite(point.x) ||
            !Number.isFinite(point.y) ||
            getConnectionPointLayers(point).length === 0
          )
            fail(`hop "${name}" has an invalid endpoint`, name)
          const pointId = point.pointId ?? point.pcb_port_id
          if (!pointId) continue
          for (const copy of srj.connections.flatMap(
            (item): typeof connection.pointsToConnect => item.pointsToConnect,
          )) {
            if ((copy.pointId ?? copy.pcb_port_id) !== pointId) continue
            if (
              copy.x !== point.x ||
              copy.y !== point.y ||
              getConnectionPointLayers(copy).toSorted().join() !==
                getConnectionPointLayers(point).toSorted().join()
            )
              fail(`endpoint "${pointId}" has inconsistent geometry`)
          }
        }
        const net = connMap.getNetConnectedToId(name)
        if (!net) fail(`hop "${name}" has no electrical identity`)
        laneNets[laneIndex]!.add(net!)
      }
    }
    if (groups.size > 1)
      fail(
        "hops span multiple routing groups/phases; end-to-end matching is unsupported",
        undefined,
        "unsupported_routing_scope",
      )
    if ([...laneNets[0]].some((net): boolean => laneNets[1].has(net)))
      fail("positive and negative lanes are electrically shorted")
  }
  return ownedNames
}
