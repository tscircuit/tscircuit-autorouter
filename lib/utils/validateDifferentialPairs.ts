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
  const connMap = getConnectivityMapFromSimpleRouteJson(srj)
  const initiallyConnected = getInitiallyConnectedMapFromSimpleRouteJson(srj)
  for (const [pairIndex, pair] of (srj.differentialPairs ?? []).entries()) {
    const fail = (message: string): never => {
      throw new DifferentialPairRoutingError(`pair ${pairIndex}: ${message}`)
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
          fail(`invalid or repeated owned hop "${name}"`)
        ownedNames.add(name)
        const matches = srj.connections.filter(
          (connection): boolean => connection.name === name,
        )
        if (matches.length !== 1)
          fail(
            `hop "${name}" must resolve to exactly one connection in this routing phase`,
          )
        const connection = matches[0]!
        if (connection.pointsToConnect.length !== 2)
          fail(`hop "${name}" must have exactly two points`)
        if (connection.isOffBoard)
          fail(`hop "${name}" cannot use off-board copper`)
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
          )
        for (const point of connection.pointsToConnect) {
          if (
            !Number.isFinite(point.x) ||
            !Number.isFinite(point.y) ||
            getConnectionPointLayers(point).length === 0
          )
            fail(`hop "${name}" has an invalid endpoint`)
          const pointId = point.pointId ?? point.pcb_port_id
          if (!pointId) continue
          for (const copy of srj.connections.flatMap(
            (item) => item.pointsToConnect,
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
      )
    if ([...laneNets[0]].some((net): boolean => laneNets[1].has(net)))
      fail("positive and negative lanes are electrically shorted")
  }
  return ownedNames
}
