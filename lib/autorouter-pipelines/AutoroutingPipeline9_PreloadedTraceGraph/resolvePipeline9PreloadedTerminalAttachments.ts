import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type {
  ConnectionPoint,
  Obstacle,
  SimpleRouteJson,
  SimplifiedPcbTrace,
  SingleLayerConnectionPoint,
} from "lib/types/srj-types"
import { getObstacleZLayersOnBoard } from "lib/utils/create-srj-with-board-valid-obstacle-layers"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import {
  createPipeline9FixedPadClearance,
  type Pipeline9FixedPadClearance,
} from "./createPipeline9FixedPadClearance"
import {
  createPipeline9SourceAttachmentEligibility,
  type Pipeline9SourceAttachmentEligibility,
} from "./createPipeline9SourceAttachmentEligibility"

type ExistingTerminalAttachment = {
  x: number
  y: number
  z: number
  width: number
}

const isInsideOriginalObstacleEnvelope = (
  point: { x: number; y: number },
  obstacle: Obstacle,
): boolean => {
  const rotation = obstacle.ccwRotationDegrees ?? 0
  if (
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y) ||
    !Number.isFinite(obstacle.center.x) ||
    !Number.isFinite(obstacle.center.y) ||
    !Number.isFinite(obstacle.width) ||
    !Number.isFinite(obstacle.height) ||
    !Number.isFinite(rotation) ||
    obstacle.width <= 0 ||
    obstacle.height <= 0
  ) {
    return false
  }
  const angle = ((rotation % 360) * Math.PI) / 180
  const dx = point.x - obstacle.center.x
  const dy = point.y - obstacle.center.y
  const localX = dx * Math.cos(angle) + dy * Math.sin(angle)
  const localY = -dx * Math.sin(angle) + dy * Math.cos(angle)
  return (
    Math.abs(localX) <= obstacle.width / 2 &&
    Math.abs(localY) <= obstacle.height / 2
  )
}

const getUniqueExistingAttachment = (params: {
  traces: readonly SimplifiedPcbTrace[]
  pcbPortId: string
  canonicalNetId: string
  connMap: ConnectivityMap
  ownPad: Obstacle
  z: number
  layerCount: number
  sourceEligibility?: {
    context: Pipeline9SourceAttachmentEligibility
    connectionName: string
  }
}): ExistingTerminalAttachment | undefined => {
  const attachments = new Map<string, ExistingTerminalAttachment>()
  for (const trace of params.traces) {
    if (
      !trace.connectsTo?.includes(params.pcbPortId) ||
      params.connMap.getNetConnectedToId(trace.pcb_trace_id) !==
        params.canonicalNetId ||
      params.connMap.getNetConnectedToId(trace.connection_name) !==
        params.canonicalNetId ||
      (params.sourceEligibility &&
        !params.sourceEligibility.context.isEligibleAttachment({
          connectionName: params.sourceEligibility.connectionName,
          pcbPortId: params.pcbPortId,
          ownPad: params.ownPad,
          trace,
        }))
    ) {
      continue
    }
    // Only actual trace boundaries are attachments; an interior wire after a
    // via, jumper or through-obstacle entry does not establish a terminal.
    for (const side of ["start", "end"] as const) {
      const endpoint = side === "start" ? trace.route[0] : trace.route.at(-1)
      if (endpoint?.route_type !== "wire") continue
      const endpointPcbPortId =
        side === "start" ? endpoint.start_pcb_port_id : endpoint.end_pcb_port_id
      if (
        (endpointPcbPortId !== undefined &&
          endpointPcbPortId !== params.pcbPortId) ||
        !Number.isFinite(endpoint.width) ||
        endpoint.width <= 0 ||
        mapLayerNameToZ(endpoint.layer, params.layerCount) !== params.z ||
        !isInsideOriginalObstacleEnvelope(endpoint, params.ownPad)
      ) {
        continue
      }
      const key = `${endpoint.x},${endpoint.y},${params.z}`
      const existing = attachments.get(key)
      attachments.set(key, {
        x: endpoint.x,
        y: endpoint.y,
        z: params.z,
        width: Math.max(endpoint.width, existing?.width ?? endpoint.width),
      })
    }
  }
  // Distinct source attachment positions are deliberately not ranked by
  // distance or DRC: they are outside this unambiguous normalization contract.
  if (attachments.size !== 1) return undefined
  return attachments.values().next().value
}

/**
 * Resolve routing-only terminals to unambiguous existing copper attachments.
 * Original SRJ geometry, trace entries and electrical identities remain intact.
 * Missing or ambiguous source attachments leave the routing input unchanged;
 * the normal pathing constraints still validate every newly searched terminal.
 */
export const resolvePipeline9PreloadedTerminalAttachments = (params: {
  originalSrj: SimpleRouteJson
  routingSrj: SimpleRouteJson
}): SimpleRouteJson => {
  const { originalSrj, routingSrj } = params
  if (!originalSrj.traces || originalSrj.traces.length === 0) return routingSrj
  if (originalSrj.layerCount !== routingSrj.layerCount) {
    throw new Error("Pipeline9 attachment inputs must use the same layer count")
  }
  const connMap = getConnectivityMapFromSimpleRouteJson(originalSrj)
  const originalPointsByPcbPortId = new Map<
    string,
    SingleLayerConnectionPoint[]
  >()
  for (const connection of originalSrj.connections) {
    for (const point of connection.pointsToConnect) {
      if (!point.pcb_port_id || !("layer" in point) || point.terminalVia) {
        continue
      }
      const originalPoints = originalPointsByPcbPortId.get(point.pcb_port_id)
      if (originalPoints) originalPoints.push(point)
      else originalPointsByPcbPortId.set(point.pcb_port_id, [point])
    }
  }
  let fixedPadClearance: Pipeline9FixedPadClearance | undefined
  let sourceAttachmentEligibility:
    | Pipeline9SourceAttachmentEligibility
    | undefined
  let changed = false
  const connections: SimpleRouteJson["connections"] = []
  for (const connection of routingSrj.connections) {
    const canonicalNetId = connMap.getNetConnectedToId(connection.name)
    let connectionChanged = false
    const pointsToConnect: ConnectionPoint[] = []
    for (const point of connection.pointsToConnect) {
      let resolvedPoint = point
      if (
        canonicalNetId &&
        point.pcb_port_id &&
        "layer" in point &&
        !point.terminalVia &&
        connMap.getNetConnectedToId(point.pcb_port_id) === canonicalNetId
      ) {
        const z = mapLayerNameToZ(point.layer, originalSrj.layerCount)
        const originalPoints = new Map<string, SingleLayerConnectionPoint>()
        for (const originalPoint of originalPointsByPcbPortId.get(
          point.pcb_port_id,
        ) ?? []) {
          if (
            mapLayerNameToZ(originalPoint.layer, originalSrj.layerCount) === z
          ) {
            originalPoints.set(
              `${originalPoint.x},${originalPoint.y}`,
              originalPoint,
            )
          }
        }
        const originalPoint = originalPoints.values().next().value
        if (
          originalPoints.size === 1 &&
          originalPoint &&
          Number.isInteger(z) &&
          z >= 0 &&
          z < originalSrj.layerCount
        ) {
          // Unsupported shapes contribute only conservative envelopes to
          // ambiguity detection. Their boxes must never authorize attachment;
          // only a unique real rectangle provides exact pad containment.
          const ownerEnvelopes: Obstacle[] = []
          for (const obstacle of originalSrj.obstacles) {
            if (
              obstacle.isCopperPour === true ||
              !obstacle.connectedTo.includes(point.pcb_port_id) ||
              !isInsideOriginalObstacleEnvelope(originalPoint, obstacle) ||
              !getObstacleZLayersOnBoard(
                obstacle,
                originalSrj.layerCount,
              ).includes(z)
            ) {
              continue
            }
            ownerEnvelopes.push(obstacle)
          }
          if (
            ownerEnvelopes.length === 1 &&
            ownerEnvelopes[0]!.type === "rect"
          ) {
            const ownPad = ownerEnvelopes[0]!
            if (
              ownPad.netIsAssignable === true &&
              !sourceAttachmentEligibility
            ) {
              sourceAttachmentEligibility =
                createPipeline9SourceAttachmentEligibility({
                  originalSrj,
                  containsPointInObstacleEnvelope:
                    isInsideOriginalObstacleEnvelope,
                })
            }
            const attachment = getUniqueExistingAttachment({
              traces: originalSrj.traces,
              pcbPortId: point.pcb_port_id,
              canonicalNetId,
              connMap,
              ownPad,
              z,
              layerCount: originalSrj.layerCount,
              sourceEligibility:
                ownPad.netIsAssignable === true
                  ? {
                      context: sourceAttachmentEligibility!,
                      connectionName: connection.name,
                    }
                  : undefined,
            })
            if (attachment) {
              if (!fixedPadClearance) {
                fixedPadClearance = createPipeline9FixedPadClearance({
                  obstacles: originalSrj.obstacles,
                  connMap,
                  layerCount: originalSrj.layerCount,
                  traceToPadClearance:
                    originalSrj.minTraceToPadEdgeClearance ?? 0.1,
                  viaToPadClearance:
                    originalSrj.minViaEdgeToPadEdgeClearance ?? 0.1,
                })
              }
              if (
                fixedPadClearance.traceClearanceIndex.isPointClear({
                  point: attachment,
                  canonicalNetId,
                  copperDiameter: Math.max(
                    routingSrj.minTraceWidth,
                    attachment.width,
                  ),
                }) &&
                (point.x !== attachment.x || point.y !== attachment.y)
              ) {
                resolvedPoint = { ...point, x: attachment.x, y: attachment.y }
                connectionChanged = true
              }
            }
          }
        }
      }
      pointsToConnect.push(resolvedPoint)
    }
    if (connectionChanged) {
      connections.push({ ...connection, pointsToConnect })
      changed = true
    } else {
      connections.push(connection)
    }
  }
  return changed ? { ...routingSrj, connections } : routingSrj
}
