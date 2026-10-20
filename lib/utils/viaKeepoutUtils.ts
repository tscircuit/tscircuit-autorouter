import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type {
  Obstacle,
  SimpleRouteJson,
  SimplifiedPcbTrace,
  ViaKeepoutRegion,
} from "lib/types/srj-types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { mapLayerNameToZ } from "./mapLayerNameToZ"

const VIA_CLEARANCE_EPSILON = 1e-6

export interface ViaPlacementViolation {
  connectionName: string
  pcbTraceId?: string
  location: { x: number; y: number }
  viaCenter: { x: number; y: number }
  viaDiameter: number
  actualClearance: number
  minimumClearance: number
  obstacleId?: string
  keepoutId?: string
  reason: "via_pad_clearance_violation" | "via_keepout_violation"
  message: string
}

const getPointToRotatedRectDistance = (
  point: { x: number; y: number },
  rect: {
    center: { x: number; y: number }
    width: number
    height: number
    ccwRotationDegrees?: number
  },
): number => {
  const rotationRadians = (-1 * (rect.ccwRotationDegrees ?? 0) * Math.PI) / 180
  const offsetX = point.x - rect.center.x
  const offsetY = point.y - rect.center.y
  const localX =
    offsetX * Math.cos(rotationRadians) - offsetY * Math.sin(rotationRadians)
  const localY =
    offsetX * Math.sin(rotationRadians) + offsetY * Math.cos(rotationRadians)
  const outsideX = Math.max(Math.abs(localX) - rect.width / 2, 0)
  const outsideY = Math.max(Math.abs(localY) - rect.height / 2, 0)
  const insideDistance = Math.min(
    Math.max(
      Math.abs(localX) - rect.width / 2,
      Math.abs(localY) - rect.height / 2,
    ),
    0,
  )
  return outsideX > 0 || outsideY > 0
    ? Math.hypot(outsideX, outsideY)
    : insideDistance
}

export const getPointToObstacleEdgeDistance = (
  point: { x: number; y: number },
  obstacle: Obstacle,
): number => {
  if (obstacle.shape === "circle") {
    const radius = Math.min(obstacle.width, obstacle.height) / 2
    return (
      Math.hypot(point.x - obstacle.center.x, point.y - obstacle.center.y) -
      radius
    )
  }
  return getPointToRotatedRectDistance(point, obstacle)
}

export const getPointToViaKeepoutRegionEdgeDistance = (
  point: { x: number; y: number },
  keepout: ViaKeepoutRegion,
): number => {
  if (keepout.shape === "circle" || typeof keepout.radius === "number") {
    const radius =
      keepout.radius ?? Math.min(keepout.width ?? 0, keepout.height ?? 0) / 2
    return (
      Math.hypot(point.x - keepout.center.x, point.y - keepout.center.y) -
      radius
    )
  }
  return getPointToRotatedRectDistance(point, {
    center: keepout.center,
    width: keepout.width ?? 0,
    height: keepout.height ?? 0,
    ccwRotationDegrees: keepout.ccwRotationDegrees,
  })
}

export const getObstacleZLayersForViaCheck = (
  obstacle: Obstacle,
  layerCount: number,
): number[] => {
  const existing = obstacle.__zLayers ?? obstacle.zLayers
  if (existing && existing.length > 0) return existing
  return obstacle.layers.map((layer) => mapLayerNameToZ(layer, layerCount))
}

export const getViaKeepoutZLayers = (
  keepout: ViaKeepoutRegion,
  layerCount: number,
): number[] => {
  if (keepout.zLayers && keepout.zLayers.length > 0) {
    return keepout.zLayers
  }
  if (keepout.layers && keepout.layers.length > 0) {
    return keepout.layers.map((layer) => mapLayerNameToZ(layer, layerCount))
  }
  return Array.from({ length: layerCount }, (_, z) => z)
}

export const doesObstacleShareNetWithRoute = ({
  obstacle,
  connectionName,
  rootConnectionName,
  connMap,
}: {
  obstacle: Obstacle
  connectionName: string
  rootConnectionName?: string
  connMap?: ConnectivityMap
}): boolean => {
  if (
    obstacle.connectedTo.includes(connectionName) ||
    (rootConnectionName !== undefined &&
      obstacle.connectedTo.includes(rootConnectionName))
  ) {
    return true
  }
  if (!connMap) return false
  if (
    connMap.areIdsConnected(
      connectionName,
      obstacle.obstacleId || obstacle.connectedTo[0] || "",
    )
  ) {
    return true
  }
  const routeNetId =
    connMap.getNetConnectedToId(connectionName) ??
    (rootConnectionName
      ? (connMap.getNetConnectedToId(rootConnectionName) ??
        (connMap.netMap[rootConnectionName] ? rootConnectionName : undefined))
      : undefined)
  if (!routeNetId) return false
  return obstacle.connectedTo.some((connectedId) => {
    const connectedNetId =
      connMap.getNetConnectedToId(connectedId) ??
      (connMap.netMap[connectedId] ? connectedId : undefined)
    return connectedNetId === routeNetId
  })
}

export const hasCustomViaKeepoutOrClearanceRules = (
  srj?: Partial<SimpleRouteJson>,
  obstacles?: readonly Obstacle[],
): boolean => {
  if (
    srj?.minViaEdgeToPadEdgeClearance !== undefined ||
    (srj?.viaKeepouts?.length ?? 0) > 0
  ) {
    return true
  }
  const obsList = obstacles ?? srj?.obstacles ?? []
  return obsList.some(
    (obstacle) =>
      obstacle.isViaKeepout === true ||
      obstacle.viaClearance !== undefined ||
      obstacle.minViaEdgeToPadEdgeClearance !== undefined,
  )
}

export const checkViaPlacementViolations = ({
  viaCenter,
  viaDiameter,
  minZ,
  maxZ,
  connectionName,
  rootConnectionName,
  pcbTraceId,
  obstacles,
  viaKeepouts,
  layerCount,
  connMap,
  defaultViaToPadClearance,
  allowViaInPad = false,
}: {
  viaCenter: { x: number; y: number }
  viaDiameter: number
  minZ: number
  maxZ: number
  connectionName: string
  rootConnectionName?: string
  pcbTraceId?: string
  obstacles: readonly Obstacle[]
  viaKeepouts?: readonly ViaKeepoutRegion[]
  layerCount: number
  connMap?: ConnectivityMap
  defaultViaToPadClearance?: number
  allowViaInPad?: boolean
}): ViaPlacementViolation[] => {
  const violations: ViaPlacementViolation[] = []
  const viaRadius = viaDiameter / 2
  const spanMinZ = Math.min(minZ, maxZ)
  const spanMaxZ = Math.max(minZ, maxZ)

  for (const keepout of viaKeepouts ?? []) {
    const keepoutZs = getViaKeepoutZLayers(keepout, layerCount)
    if (!keepoutZs.some((z) => z >= spanMinZ && z <= spanMaxZ)) continue
    const requiredClearance = keepout.clearance ?? keepout.viaClearance ?? 0
    const actualClearance =
      getPointToViaKeepoutRegionEdgeDistance(viaCenter, keepout) - viaRadius
    if (actualClearance + VIA_CLEARANCE_EPSILON < requiredClearance) {
      const location = {
        x: (viaCenter.x + keepout.center.x) / 2,
        y: (viaCenter.y + keepout.center.y) / 2,
      }
      violations.push({
        connectionName,
        pcbTraceId,
        location: viaCenter,
        viaCenter,
        viaDiameter,
        actualClearance,
        minimumClearance: requiredClearance,
        keepoutId: keepout.keepoutId,
        reason: "via_keepout_violation",
        message: `Via on "${connectionName}" at (${viaCenter.x.toFixed(3)}mm, ${viaCenter.y.toFixed(3)}mm) violates via keepout${keepout.keepoutId ? ` "${keepout.keepoutId}"` : ""} at (${location.x.toFixed(3)}mm, ${location.y.toFixed(3)}mm) (clearance: ${actualClearance.toFixed(3)}mm, minimum: ${requiredClearance.toFixed(3)}mm)`,
      })
    }
  }

  for (const obstacle of obstacles) {
    if (obstacle.isCopperPour) continue
    const obstacleZs = getObstacleZLayersForViaCheck(obstacle, layerCount)
    if (!obstacleZs.some((z) => z >= spanMinZ && z <= spanMaxZ)) continue

    const obstacleSpecificClearance =
      obstacle.viaClearance ?? obstacle.minViaEdgeToPadEdgeClearance

    if (obstacle.isViaKeepout) {
      const requiredKeepoutClearance = obstacleSpecificClearance ?? 0
      const actualClearance =
        getPointToObstacleEdgeDistance(viaCenter, obstacle) - viaRadius
      if (actualClearance + VIA_CLEARANCE_EPSILON < requiredKeepoutClearance) {
        violations.push({
          connectionName,
          pcbTraceId,
          location: viaCenter,
          viaCenter,
          viaDiameter,
          actualClearance,
          minimumClearance: requiredKeepoutClearance,
          obstacleId: obstacle.obstacleId,
          reason: "via_keepout_violation",
          message: `Via on "${connectionName}" at (${viaCenter.x.toFixed(3)}mm, ${viaCenter.y.toFixed(3)}mm) violates via keepout obstacle${obstacle.obstacleId ? ` "${obstacle.obstacleId}"` : ""} (clearance: ${actualClearance.toFixed(3)}mm, minimum: ${requiredKeepoutClearance.toFixed(3)}mm)`,
        })
      }
      continue
    }

    const sharesNet = doesObstacleShareNetWithRoute({
      obstacle,
      connectionName,
      rootConnectionName,
      connMap,
    })

    // Same-net pads only enforce via clearance when an explicit per-obstacle
    // viaClearance / minViaEdgeToPadEdgeClearance keep-out is configured on the pad
    // (e.g. "no vias within X of this footprint's pads" to steer QFP fan-out)
    // and allowViaInPad is false.
    if (
      sharesNet &&
      (obstacleSpecificClearance === undefined || allowViaInPad)
    ) {
      continue
    }

    const requiredClearance = sharesNet
      ? obstacleSpecificClearance
      : Math.max(
          defaultViaToPadClearance ?? -1,
          obstacleSpecificClearance ?? -1,
        )
    if (requiredClearance === undefined || requiredClearance < 0) {
      continue
    }

    const actualClearance =
      getPointToObstacleEdgeDistance(viaCenter, obstacle) - viaRadius
    if (actualClearance + VIA_CLEARANCE_EPSILON < requiredClearance) {
      const location = {
        x: (viaCenter.x + obstacle.center.x) / 2,
        y: (viaCenter.y + obstacle.center.y) / 2,
      }
      violations.push({
        connectionName,
        pcbTraceId,
        location,
        viaCenter,
        viaDiameter,
        actualClearance,
        minimumClearance: requiredClearance,
        obstacleId: obstacle.obstacleId,
        reason: sharesNet
          ? "via_keepout_violation"
          : "via_pad_clearance_violation",
        message: `Via on "${connectionName}" at (${viaCenter.x.toFixed(3)}mm, ${viaCenter.y.toFixed(3)}mm) and pad${obstacle.obstacleId ? ` "${obstacle.obstacleId}"` : ""} at (${obstacle.center.x.toFixed(3)}mm, ${obstacle.center.y.toFixed(3)}mm) are too close (clearance: ${actualClearance.toFixed(3)}mm, minimum: ${requiredClearance.toFixed(3)}mm)`,
      })
    }
  }

  return violations
}

export const getHdRoutesViaPlacementViolations = ({
  routes,
  obstacles,
  viaKeepouts,
  layerCount,
  allowBlindAndBuriedVias = false,
  connMap,
  defaultViaToPadClearance,
  allowViaInPad = false,
}: {
  routes: readonly HighDensityRoute[]
  obstacles: readonly Obstacle[]
  viaKeepouts?: readonly ViaKeepoutRegion[]
  layerCount: number
  allowBlindAndBuriedVias?: boolean
  connMap?: ConnectivityMap
  defaultViaToPadClearance?: number
  allowViaInPad?: boolean
}): ViaPlacementViolation[] => {
  const violations: ViaPlacementViolation[] = []

  for (const route of routes) {
    const viaSpans = new Map<
      string,
      { center: { x: number; y: number }; minZ: number; maxZ: number }
    >()

    for (let i = 1; i < route.route.length; i++) {
      const prev = route.route[i - 1]!
      const curr = route.route[i]!
      if (
        Math.abs(prev.x - curr.x) <= 1e-6 &&
        Math.abs(prev.y - curr.y) <= 1e-6 &&
        prev.z !== curr.z
      ) {
        const key = `${curr.x.toFixed(5)},${curr.y.toFixed(5)}`
        const minZ = allowBlindAndBuriedVias ? Math.min(prev.z, curr.z) : 0
        const maxZ = allowBlindAndBuriedVias
          ? Math.max(prev.z, curr.z)
          : Math.max(0, layerCount - 1)
        const existing = viaSpans.get(key)
        if (existing) {
          existing.minZ = Math.min(existing.minZ, minZ)
          existing.maxZ = Math.max(existing.maxZ, maxZ)
        } else {
          viaSpans.set(key, {
            center: { x: curr.x, y: curr.y },
            minZ,
            maxZ,
          })
        }
      }
    }

    for (const via of route.vias ?? []) {
      const key = `${via.x.toFixed(5)},${via.y.toFixed(5)}`
      if (!viaSpans.has(key)) {
        viaSpans.set(key, {
          center: { x: via.x, y: via.y },
          minZ: 0,
          maxZ: Math.max(0, layerCount - 1),
        })
      }
    }

    for (const viaSpan of viaSpans.values()) {
      violations.push(
        ...checkViaPlacementViolations({
          viaCenter: viaSpan.center,
          viaDiameter: route.viaDiameter,
          minZ: viaSpan.minZ,
          maxZ: viaSpan.maxZ,
          connectionName: route.connectionName,
          rootConnectionName: route.rootConnectionName,
          obstacles,
          viaKeepouts,
          layerCount,
          connMap,
          defaultViaToPadClearance,
          allowViaInPad,
        }),
      )
    }
  }

  return violations
}

export const getSimplifiedTracesViaPlacementViolations = ({
  traces,
  srj,
  connMap,
  defaultViaDiameter,
}: {
  traces: readonly SimplifiedPcbTrace[]
  srj: SimpleRouteJson
  connMap?: ConnectivityMap
  defaultViaDiameter: number
}): ViaPlacementViolation[] => {
  const violations: ViaPlacementViolation[] = []
  const defaultViaToPadClearance = srj.minViaEdgeToPadEdgeClearance

  for (const trace of traces) {
    for (const point of trace.route) {
      if (point.route_type !== "via") continue
      const fromZ = mapLayerNameToZ(point.from_layer, srj.layerCount)
      const toZ = mapLayerNameToZ(point.to_layer, srj.layerCount)
      const minZ = srj.allowBlindAndBuriedVias ? Math.min(fromZ, toZ) : 0
      const maxZ = srj.allowBlindAndBuriedVias
        ? Math.max(fromZ, toZ)
        : Math.max(0, srj.layerCount - 1)
      violations.push(
        ...checkViaPlacementViolations({
          viaCenter: { x: point.x, y: point.y },
          viaDiameter: point.via_diameter ?? defaultViaDiameter,
          minZ,
          maxZ,
          connectionName: trace.connection_name,
          pcbTraceId: trace.pcb_trace_id,
          obstacles: srj.obstacles,
          viaKeepouts: srj.viaKeepouts,
          layerCount: srj.layerCount,
          connMap,
          defaultViaToPadClearance,
          allowViaInPad: srj.allowViaInPad ?? false,
        }),
      )
    }
  }

  return violations
}
