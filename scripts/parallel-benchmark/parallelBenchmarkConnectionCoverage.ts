import type { AnyCircuitElement, PcbTraceError } from "circuit-json"
import type { ConnectionPoint, SimpleRouteJson } from "../../lib/types/srj-types"
import { getConnectionPointLayers } from "../../lib/types/srj-types"
import { getConnectivityMapFromSimpleRouteJson } from "../../lib/utils/getConnectivityMapFromSimpleRouteJson"
import { buildPhysicalConnectivity } from "./parallelBenchmarkPhysicalConnectivity"
import type { ParallelBenchmarkQuality } from "./parallelBenchmarkTypes"

type CoverageGroup = { netId: string; connectionNames: string[]; portIds: string[] }
export type ConnectionCoverageEvaluation = {
  summary: NonNullable<ParallelBenchmarkQuality["connectionCoverage"]>
  requiredNets: CoverageGroup[]
  missingRouteNets: CoverageGroup[]
  missingPortIds: string[]
  coincidentPadAliases: Array<{ portId: string; existingPortId: string }>
  pointTerminalPortIds: string[]
  continuityErrors: PcbTraceError[]
}

/** Prove original terminal requirements against actual copper components. */
export const evaluateConnectionCoverage = (
  inputSrj: SimpleRouteJson,
  circuitJson: AnyCircuitElement[],
): ConnectionCoverageEvaluation => {
  const logicalMap = getConnectivityMapFromSimpleRouteJson(inputSrj)
  for (const connection of inputSrj.connections) logicalMap.addConnections([[
    connection.name,
    ...[
      connection.source_trace_id, connection.rootConnectionName, connection.netConnectionName,
      connection.__netConnectionName, ...(connection.__rootConnectionNames ?? []),
      ...(connection.mergedConnectionNames ?? []),
    ].filter((alias): alias is string => typeof alias === "string" && alias.length > 0),
  ]])
  const groups = new Map<string, CoverageGroup & { terminals: Map<string, ConnectionPoint> }>()
  const missingPortIds = new Set<string>()
  const presentPorts = new Set(circuitJson.flatMap((element) => element.type === "pcb_port" ? [element.pcb_port_id] : []))
  for (const connection of inputSrj.connections) {
    if (connection.isOffBoard) continue
    const netId = logicalMap.getNetConnectedToId(connection.name)
    if (!netId) throw new Error(`Missing original connectivity net: ${connection.name}`)
    const group = groups.get(netId) ?? { netId, connectionNames: [], portIds: [], terminals: new Map<string, ConnectionPoint>() }
    group.connectionNames.push(connection.name)
    for (const [index, point] of connection.pointsToConnect.entries()) {
      if (!point.pcb_port_id) missingPortIds.add(`${connection.name}:point${index}`)
      else {
        if (!presentPorts.has(point.pcb_port_id)) missingPortIds.add(point.pcb_port_id)
        if (!group.portIds.includes(point.pcb_port_id)) group.portIds.push(point.pcb_port_id)
      }
      const key = JSON.stringify([point.pcb_port_id, point.x, point.y, [...getConnectionPointLayers(point)].sort()])
      group.terminals.set(key, point)
    }
    groups.set(netId, group)
  }
  const physicalMap = buildPhysicalConnectivity(circuitJson, inputSrj.layerCount)
  const requiredGroups = [...groups.values()].filter((group) => group.terminals.size >= 2)
  const requiredNets = requiredGroups.map(({ terminals: _terminals, ...group }) => group)
  const missingRouteNets: CoverageGroup[] = []
  const continuityErrors: PcbTraceError[] = []
  const coincidentPadAliases: ConnectionCoverageEvaluation["coincidentPadAliases"] = []
  const pointTerminalPortIds = new Set<string>()
  for (const group of requiredGroups) {
    let commonComponents: Set<number> | undefined
    let hasWireContact = false
    for (const point of group.terminals.values()) {
      const contacts = physicalMap.getContacts(point, getConnectionPointLayers(point))
      hasWireContact ||= contacts.some((contact) => contact.sourceType !== "pad")
      const padContacts = contacts.filter((contact) => contact.sourceType === "pad")
      if (point.pcb_port_id) {
        if (padContacts.length === 0) pointTerminalPortIds.add(point.pcb_port_id)
        for (const contact of padContacts) {
          if (contact.padPortId && contact.padPortId !== point.pcb_port_id &&
            logicalMap.areIdsConnected(contact.padPortId, point.pcb_port_id)) {
            const alias = { portId: point.pcb_port_id, existingPortId: contact.padPortId }
            if (!coincidentPadAliases.some((entry) => entry.portId === alias.portId && entry.existingPortId === alias.existingPortId)) coincidentPadAliases.push(alias)
          }
        }
      }
      const components = new Set(contacts.map((contact) => contact.component))
      commonComponents = commonComponents === undefined ? components :
        new Set([...commonComponents].filter((component) => components.has(component)))
    }
    if (!commonComponents || commonComponents.size === 0) {
      const { terminals: _terminals, ...description } = group
      if (!hasWireContact) missingRouteNets.push(description)
      continuityErrors.push({
        type: "pcb_trace_error", error_type: "pcb_trace_error",
        pcb_trace_error_id: `coverage:${group.netId}`, source_trace_id: `coverage:${group.netId}`,
        pcb_trace_id: `coverage:${group.netId}`, pcb_component_ids: [], pcb_port_ids: group.portIds,
        message: `Original net ${group.connectionNames.join(", ")} has terminals in different physical copper components`,
      })
    }
  }
  return {
    summary: {
      requiredNetCount: requiredGroups.length,
      requiredPairCount: requiredGroups.reduce((sum, group) => sum + group.terminals.size - 1, 0),
      coveredNetCount: requiredGroups.length - continuityErrors.length,
      uncoveredNetCount: continuityErrors.length,
      missingPortCount: missingPortIds.size,
      singletonNetCount: [...groups.values()].filter((group) => group.terminals.size === 1).length,
      errorCount: continuityErrors.length + missingPortIds.size,
    },
    requiredNets, missingRouteNets, missingPortIds: [...missingPortIds],
    coincidentPadAliases, pointTerminalPortIds: [...pointTerminalPortIds], continuityErrors,
  }
}
