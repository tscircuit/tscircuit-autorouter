import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type {
  Obstacle,
  SimpleRouteJson,
  SimplifiedPcbTrace,
} from "lib/types/srj-types"
import { getObstacleZLayersOnBoard } from "lib/utils/create-srj-with-board-valid-obstacle-layers"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"

type SourceBoundary = {
  x: number
  y: number
  zLayers: number[]
}

type SourceAttachmentGroup = {
  obstacles: Obstacle[]
  aliasIds: Set<string>
  declaredNetIds: Set<string>
  hasUnknownClaim: boolean
}

type SourceAttachmentInput = {
  connectionName: string
  pcbPortId: string
  ownPad: Obstacle
  trace: SimplifiedPcbTrace
}

export type Pipeline9SourceAttachmentEligibility = {
  isEligibleAttachment: (params: SourceAttachmentInput) => boolean
}

type SourceAttachmentEligibilityParams = {
  originalSrj: SimpleRouteJson
  containsPointInObstacleEnvelope: (
    point: { x: number; y: number },
    obstacle: Obstacle,
  ) => boolean
}

const getDeclaredNetIds = (srj: SimpleRouteJson): Map<string, string> => {
  const connMap = new ConnectivityMap({})
  const declaredIds = new Set<string>()
  for (const connection of srj.connections) {
    const ids = new Set<string>([connection.name])
    for (const rootName of connection.__rootConnectionNames ?? []) {
      ids.add(rootName)
    }
    if (connection.__netConnectionName) {
      ids.add(connection.__netConnectionName)
    }
    for (const point of connection.pointsToConnect) {
      if (point.pcb_port_id) ids.add(point.pcb_port_id)
      if (point.pointId) ids.add(point.pointId)
    }
    for (const id of ids) {
      if (typeof id !== "string" || id.trim().length === 0) {
        throw new Error(
          "Pipeline9 source attachment declarations require nonempty electrical IDs",
        )
      }
    }
    connMap.addConnections([[...ids]])
    for (const id of ids) declaredIds.add(id)
  }
  const declaredNetIds = new Map<string, string>()
  for (const id of declaredIds) {
    const netId = connMap.getNetConnectedToId(id)
    if (netId !== undefined) declaredNetIds.set(id, netId)
  }
  return declaredNetIds
}

const getDeclaredTraceNetId = (
  trace: SimplifiedPcbTrace,
  declaredNetIds: ReadonlyMap<string, string>,
): string | undefined => {
  const netId = declaredNetIds.get(trace.connection_name)
  if (netId === undefined || !trace.connectsTo?.length) return undefined
  for (const id of trace.connectsTo) {
    if (declaredNetIds.get(id) !== netId) return undefined
  }
  const first = trace.route[0]
  const last = trace.route.at(-1)
  for (const id of [
    first?.route_type === "wire" ? first.start_pcb_port_id : undefined,
    last?.route_type === "wire" ? last.end_pcb_port_id : undefined,
  ]) {
    if (id !== undefined && declaredNetIds.get(id) !== netId) return undefined
  }
  return netId
}

const getSourceBoundaries = (
  trace: SimplifiedPcbTrace,
  layerCount: number,
): SourceBoundary[] => {
  const boundaries: SourceBoundary[] = []
  for (const side of ["start", "end"] as const) {
    const entry = side === "start" ? trace.route[0] : trace.route.at(-1)
    if (!entry) continue
    if (entry.route_type === "wire") {
      boundaries.push({
        x: entry.x,
        y: entry.y,
        zLayers: [mapLayerNameToZ(entry.layer, layerCount)],
      })
    } else if (entry.route_type === "via") {
      const fromZ = mapLayerNameToZ(entry.from_layer, layerCount)
      const toZ = mapLayerNameToZ(entry.to_layer, layerCount)
      const zLayers: number[] = []
      if (
        Number.isInteger(fromZ) &&
        Number.isInteger(toZ) &&
        fromZ >= 0 &&
        fromZ < layerCount &&
        toZ >= 0 &&
        toZ < layerCount
      ) {
        for (let z = Math.min(fromZ, toZ); z <= Math.max(fromZ, toZ); z++) {
          zLayers.push(z)
        }
      }
      boundaries.push({ x: entry.x, y: entry.y, zLayers })
    } else {
      const point = side === "start" ? entry.start : entry.end
      const layer =
        entry.route_type === "jumper"
          ? entry.layer
          : side === "start"
            ? entry.from_layer
            : entry.to_layer
      boundaries.push({
        x: point.x,
        y: point.y,
        zLayers: [mapLayerNameToZ(layer, layerCount)],
      })
    }
  }
  return boundaries
}

const getOffBoardAttachmentGroups = (
  obstacles: readonly Obstacle[],
  declaredNetIds: ReadonlyMap<string, string>,
): SourceAttachmentGroup[] => {
  const obstaclesByOffBoardId = new Map<string, Obstacle[]>()
  for (const obstacle of obstacles) {
    for (const id of obstacle.offBoardConnectsTo ?? []) {
      if (typeof id !== "string" || id.length === 0) continue
      const members = obstaclesByOffBoardId.get(id)
      if (members) members.push(obstacle)
      else obstaclesByOffBoardId.set(id, [obstacle])
    }
  }
  const visited = new Set<Obstacle>()
  const groups: SourceAttachmentGroup[] = []
  for (const obstacle of obstacles) {
    if (visited.has(obstacle)) continue
    const group: SourceAttachmentGroup = {
      obstacles: [],
      aliasIds: new Set<string>(),
      declaredNetIds: new Set<string>(),
      hasUnknownClaim: false,
    }
    const pending = [obstacle]
    const visitedOffBoardIds = new Set<string>()
    visited.add(obstacle)
    let containsAssignablePad = false
    while (pending.length > 0) {
      const member = pending.pop()!
      group.obstacles.push(member)
      if (member.netIsAssignable === true) containsAssignablePad = true
      for (const id of member.connectedTo) {
        group.aliasIds.add(id)
        const netId = declaredNetIds.get(id)
        if (netId !== undefined) group.declaredNetIds.add(netId)
      }
      for (const id of member.offBoardConnectsTo ?? []) {
        if (typeof id !== "string" || id.length === 0) {
          group.hasUnknownClaim = true
          continue
        }
        if (visitedOffBoardIds.has(id)) continue
        visitedOffBoardIds.add(id)
        for (const connected of obstaclesByOffBoardId.get(id) ?? []) {
          if (visited.has(connected)) continue
          visited.add(connected)
          pending.push(connected)
        }
      }
    }
    if (containsAssignablePad) groups.push(group)
  }
  return groups
}

/**
 * Recognizes an existing source attachment, never an assignment of pad copper.
 * Declared identities exclude obstacle, trace and rounded-coordinate unions so
 * competing source claims cannot establish agreement by merging themselves.
 * Boundary checks reject ambiguous attachments over the whole off-board group;
 * they are not a certificate against inherited foreign trace-interior shorts.
 * Unsupported obstacle envelopes may disqualify, but only the caller's exact
 * real-rectangle containment can authorize reuse of an actual wire endpoint.
 */
export const createPipeline9SourceAttachmentEligibility = (
  params: SourceAttachmentEligibilityParams,
): Pipeline9SourceAttachmentEligibility => {
  const { originalSrj, containsPointInObstacleEnvelope } = params
  const declaredNetIds = getDeclaredNetIds(originalSrj)
  const groups = getOffBoardAttachmentGroups(
    originalSrj.obstacles,
    declaredNetIds,
  )
  const groupByObstacle = new Map<Obstacle, SourceAttachmentGroup>()
  const traceNetIds = new Map<SimplifiedPcbTrace, string | undefined>()
  const obstacleLayers = new Map<Obstacle, number[]>()
  for (const group of groups) {
    for (const obstacle of group.obstacles) {
      groupByObstacle.set(obstacle, group)
      obstacleLayers.set(
        obstacle,
        getObstacleZLayersOnBoard(obstacle, originalSrj.layerCount),
      )
    }
  }
  for (const trace of originalSrj.traces ?? []) {
    const netId = getDeclaredTraceNetId(trace, declaredNetIds)
    traceNetIds.set(trace, netId)
    const referencedIds = new Set<string>(trace.connectsTo ?? [])
    const first = trace.route[0]
    const last = trace.route.at(-1)
    if (first?.route_type === "wire" && first.start_pcb_port_id) {
      referencedIds.add(first.start_pcb_port_id)
    }
    if (last?.route_type === "wire" && last.end_pcb_port_id) {
      referencedIds.add(last.end_pcb_port_id)
    }
    const boundaries = getSourceBoundaries(trace, originalSrj.layerCount)
    for (const group of groups) {
      let touchesGroup = group.aliasIds.has(trace.pcb_trace_id)
      for (const id of referencedIds) {
        if (group.aliasIds.has(id)) touchesGroup = true
      }
      for (const boundary of boundaries) {
        for (const obstacle of group.obstacles) {
          if (!containsPointInObstacleEnvelope(boundary, obstacle)) continue
          const layers = obstacleLayers.get(obstacle)!
          let invalidLayers = boundary.zLayers.length === 0
          for (const z of boundary.zLayers) {
            if (!Number.isInteger(z) || z < 0 || z >= originalSrj.layerCount) {
              invalidLayers = true
            }
          }
          if (invalidLayers) {
            touchesGroup = true
            group.hasUnknownClaim = true
          } else {
            for (const z of boundary.zLayers) {
              if (layers.includes(z)) touchesGroup = true
            }
          }
        }
      }
      if (!touchesGroup) continue
      if (netId === undefined) group.hasUnknownClaim = true
      else group.declaredNetIds.add(netId)
    }
  }
  return {
    isEligibleAttachment(input: SourceAttachmentInput): boolean {
      const netId = declaredNetIds.get(input.connectionName)
      const group = groupByObstacle.get(input.ownPad)
      return (
        netId !== undefined &&
        declaredNetIds.get(input.pcbPortId) === netId &&
        traceNetIds.get(input.trace) === netId &&
        group !== undefined &&
        !group.hasUnknownClaim &&
        group.declaredNetIds.size === 1 &&
        group.declaredNetIds.has(netId)
      )
    },
  }
}
