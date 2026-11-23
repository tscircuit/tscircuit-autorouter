import { pointToSegmentClosestPoint } from "@tscircuit/math-utils"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { isObstacleConnectedToRoute } from "lib/solvers/TraceWidthSolver/isObstacleConnectedToRoute"
import type { Obstacle } from "lib/types"
import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import { createObjectsWithZLayers } from "lib/utils/createObjectsWithZLayers"
import type { MHPoint2, PolyLine2 } from "./types2"

export type LayeredBoardObstacle = Obstacle & { __zLayers: number[] }

export type SignedObstacleDistance = {
  /** Signed distance from point/segment center to the obstacle copper edge (< 0 when inside). */
  signedDistanceToEdge: number
  /** Unit outward normal in board coordinates pushing away from the obstacle. */
  nx: number
  ny: number
  /** For segments, interpolation parameter in [0, 1] along (p1 -> p2) nearest to the obstacle. */
  t: number
}

const EPS = 1e-9

const rotate = (
  x: number,
  y: number,
  radians: number,
): { x: number; y: number } => {
  if (radians === 0) return { x, y }
  const c = Math.cos(radians)
  const s = Math.sin(radians)
  return { x: x * c - y * s, y: x * s + y * c }
}

export const pointToObstacleSignedDistance = (
  bx: number,
  by: number,
  obstacle: Obstacle,
): SignedObstacleDistance => {
  const radians = ((obstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180
  const local = rotate(bx - obstacle.center.x, by - obstacle.center.y, -radians)

  if (obstacle.shape === "circle") {
    const radius = Math.max(obstacle.width, obstacle.height) / 2
    const d = Math.hypot(local.x, local.y)
    const ux = d > EPS ? local.x / d : 1
    const uy = d > EPS ? local.y / d : 0
    const worldDir = rotate(ux, uy, radians)
    return {
      signedDistanceToEdge: d - radius,
      nx: worldDir.x,
      ny: worldDir.y,
      t: 0,
    }
  }

  const hx = obstacle.width / 2
  const hy = obstacle.height / 2
  let signedDistanceToEdge: number
  let ux: number
  let uy: number

  if (Math.abs(local.x) > hx || Math.abs(local.y) > hy) {
    const cx = Math.max(-hx, Math.min(hx, local.x))
    const cy = Math.max(-hy, Math.min(hy, local.y))
    const ox = local.x - cx
    const oy = local.y - cy
    const d = Math.hypot(ox, oy)
    signedDistanceToEdge = d
    ux = d > EPS ? ox / d : 1
    uy = d > EPS ? oy / d : 0
  } else {
    const px = hx - Math.abs(local.x)
    const py = hy - Math.abs(local.y)
    if (px <= py) {
      signedDistanceToEdge = -px
      ux = local.x >= 0 ? 1 : -1
      uy = 0
    } else {
      signedDistanceToEdge = -py
      ux = 0
      uy = local.y >= 0 ? 1 : -1
    }
  }

  const worldDir = rotate(ux, uy, radians)
  return {
    signedDistanceToEdge,
    nx: worldDir.x,
    ny: worldDir.y,
    t: 0,
  }
}

/** Liang-Barsky clip of segment (p1 -> p2) against [-hx, hx] x [-hy, hy]. */
const clipSegmentToBox = (
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  hx: number,
  hy: number,
): [number, number] | null => {
  const dx = p2.x - p1.x
  const dy = p2.y - p1.y
  let t0 = 0
  let t1 = 1
  const clip = (p: number, q: number): boolean => {
    if (Math.abs(p) <= EPS) return q >= 0
    const r = q / p
    if (p < 0) {
      if (r > t1) return false
      if (r > t0) t0 = r
    } else {
      if (r < t0) return false
      if (r < t1) t1 = r
    }
    return true
  }
  if (
    !clip(-dx, p1.x + hx) ||
    !clip(dx, hx - p1.x) ||
    !clip(-dy, p1.y + hy) ||
    !clip(dy, hy - p1.y)
  ) {
    return null
  }
  return [t0, t1]
}

export const segmentToObstacleSignedDistance = (
  b1x: number,
  b1y: number,
  b2x: number,
  b2y: number,
  obstacle: Obstacle,
): SignedObstacleDistance => {
  const segDx = b2x - b1x
  const segDy = b2y - b1y
  const segLenSq = segDx * segDx + segDy * segDy
  if (segLenSq <= EPS) {
    return pointToObstacleSignedDistance(b1x, b1y, obstacle)
  }

  const radians = ((obstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180
  const p1 = rotate(b1x - obstacle.center.x, b1y - obstacle.center.y, -radians)
  const p2 = rotate(b2x - obstacle.center.x, b2y - obstacle.center.y, -radians)

  if (obstacle.shape === "circle") {
    const radius = Math.max(obstacle.width, obstacle.height) / 2
    const cp = pointToSegmentClosestPoint({ x: 0, y: 0 }, p1, p2)
    const d = Math.hypot(cp.x, cp.y)
    const ux = d > EPS ? cp.x / d : 1
    const uy = d > EPS ? cp.y / d : 0
    const worldDir = rotate(ux, uy, radians)
    const ldx = p2.x - p1.x
    const ldy = p2.y - p1.y
    const t = Math.max(
      0,
      Math.min(1, ((cp.x - p1.x) * ldx + (cp.y - p1.y) * ldy) / segLenSq),
    )
    return {
      signedDistanceToEdge: d - radius,
      nx: worldDir.x,
      ny: worldDir.y,
      t,
    }
  }

  const hx = obstacle.width / 2
  const hy = obstacle.height / 2
  const clipped = clipSegmentToBox(p1, p2, hx, hy)
  if (clipped) {
    const midT = (clipped[0] + clipped[1]) / 2
    const mx = b1x + segDx * midT
    const my = b1y + segDy * midT
    const inside = pointToObstacleSignedDistance(mx, my, obstacle)
    return { ...inside, t: midT }
  }

  // Completely outside rectangle: check segment endpoints against box and box corners against segment.
  let best = pointToObstacleSignedDistance(b1x, b1y, obstacle)
  best.t = 0
  const endDist = pointToObstacleSignedDistance(b2x, b2y, obstacle)
  if (endDist.signedDistanceToEdge < best.signedDistanceToEdge) {
    best = { ...endDist, t: 1 }
  }

  const ldx = p2.x - p1.x
  const ldy = p2.y - p1.y
  const corners = [
    { x: -hx, y: -hy },
    { x: -hx, y: hy },
    { x: hx, y: -hy },
    { x: hx, y: hy },
  ]
  for (const corner of corners) {
    const cp = pointToSegmentClosestPoint(corner, p1, p2)
    const ox = cp.x - corner.x
    const oy = cp.y - corner.y
    const d = Math.hypot(ox, oy)
    if (d < best.signedDistanceToEdge) {
      const ux = d > EPS ? ox / d : 1
      const uy = d > EPS ? oy / d : 0
      const worldDir = rotate(ux, uy, radians)
      const t = Math.max(
        0,
        Math.min(1, ((cp.x - p1.x) * ldx + (cp.y - p1.y) * ldy) / segLenSq),
      )
      best = {
        signedDistanceToEdge: d,
        nx: worldDir.x,
        ny: worldDir.y,
        t,
      }
    }
  }

  return best
}

const isObstacleOnSameNet = (
  obstacle: Obstacle,
  route: { connectionName: string; rootConnectionName?: string },
  connMap?: ConnectivityMap,
): boolean => {
  if (isObstacleConnectedToRoute(obstacle, route, connMap)) return true
  if (!connMap || !route.rootConnectionName) return false

  const routeNetId =
    connMap.getNetConnectedToId(route.connectionName) ??
    connMap.getNetConnectedToId(route.rootConnectionName) ??
    (connMap.netMap[route.rootConnectionName]
      ? route.rootConnectionName
      : undefined)
  if (!routeNetId) return false

  return obstacle.connectedTo.some((connectedId) => {
    const connectedNetId =
      connMap.getNetConnectedToId(connectedId) ??
      (connMap.netMap[connectedId] ? connectedId : undefined)
    return connectedNetId === routeNetId
  })
}

export type PreparedNodeObstacleContext = {
  hasForeignObstacles: boolean
  nodeCenter: { x: number; y: number }
  physicalHalfW: number
  physicalHalfH: number
  coordinateScale: number
  viaClearance: number
  allowBlindAndBuriedVias: boolean
  foreignObstaclesByConnection: Map<string, LayeredBoardObstacle[]>
  sameNetSmdPadsByConnection: Map<string, LayeredBoardObstacle[]>
  requiredGapByConnection: Map<string, number>
}

export const toBoardCoords = (
  point: { x: number; y: number },
  center: { x: number; y: number },
  coordinateScale: number,
): { x: number; y: number } =>
  coordinateScale === 1
    ? point
    : {
        x: center.x + (point.x - center.x) / coordinateScale,
        y: center.y + (point.y - center.y) / coordinateScale,
      }

export const viaOverlapsObstacleLayers = (
  via: Pick<MHPoint2, "z1" | "z2">,
  obstacle: LayeredBoardObstacle,
  allowBlindAndBuriedVias: boolean,
): boolean => {
  if (!allowBlindAndBuriedVias || obstacle.isNonPlatedHole) return true
  const minZ = Math.min(via.z1, via.z2)
  const maxZ = Math.max(via.z1, via.z2)
  return obstacle.__zLayers.some((z) => z >= minZ && z <= maxZ)
}

export const prepareNodeObstacleContext = (params: {
  nodeWithPortPoints: NodeWithPortPoints
  obstacles?: Obstacle[]
  connMap?: ConnectivityMap
  layerCount: number
  viaDiameter: number
  traceWidth: number
  obstacleMargin: number
  viaClearance?: number
  coordinateScale: number
  allowBlindAndBuriedVias: boolean
}): PreparedNodeObstacleContext => {
  const {
    nodeWithPortPoints,
    obstacles,
    connMap,
    layerCount,
    viaDiameter,
    traceWidth,
    obstacleMargin,
    coordinateScale,
    allowBlindAndBuriedVias,
  } = params
  const viaClearance = params.viaClearance ?? obstacleMargin

  const nodeCenter = nodeWithPortPoints.center
  const physicalHalfW = nodeWithPortPoints.width / (2 * coordinateScale)
  const physicalHalfH = nodeWithPortPoints.height / (2 * coordinateScale)
  const foreignObstaclesByConnection = new Map<string, LayeredBoardObstacle[]>()
  const sameNetSmdPadsByConnection = new Map<string, LayeredBoardObstacle[]>()
  const requiredGapByConnection = new Map<string, number>()

  if (!obstacles || obstacles.length === 0) {
    return {
      hasForeignObstacles: false,
      nodeCenter,
      physicalHalfW,
      physicalHalfH,
      coordinateScale,
      viaClearance,
      allowBlindAndBuriedVias,
      foreignObstaclesByConnection,
      sameNetSmdPadsByConnection,
      requiredGapByConnection,
    }
  }

  // Include nearby board copper around the node so vias/segments spilling past
  // the boundary (e.g. BOUNDARY_PADDING < 0) see neighbouring pads.
  const reach =
    Math.max(viaDiameter, traceWidth) +
    Math.max(obstacleMargin, viaClearance) * 2 +
    1.0
  const envMinX = nodeCenter.x - physicalHalfW - reach
  const envMaxX = nodeCenter.x + physicalHalfW + reach
  const envMinY = nodeCenter.y - physicalHalfH - reach
  const envMaxY = nodeCenter.y + physicalHalfH + reach

  const nearbyRaw = obstacles
    .filter((obs) => {
      if (obs.isFanoutSourceKeepout || obs.isCopperPour) return false
      const r = Math.hypot(obs.width, obs.height) / 2
      return (
        obs.center.x + r >= envMinX &&
        obs.center.x - r <= envMaxX &&
        obs.center.y + r >= envMinY &&
        obs.center.y - r <= envMaxY
      )
    })
    .map((obs) => ({
      ...obs,
      connectedTo: [...new Set(obs.connectedTo)],
    }))

  if (nearbyRaw.length === 0) {
    return {
      hasForeignObstacles: false,
      nodeCenter,
      physicalHalfW,
      physicalHalfH,
      coordinateScale,
      viaClearance,
      allowBlindAndBuriedVias,
      foreignObstaclesByConnection,
      sameNetSmdPadsByConnection,
      requiredGapByConnection,
    }
  }

  const layeredObstacles = createObjectsWithZLayers(nearbyRaw, layerCount)
  const portsByConnection = new Map<
    string,
    {
      rootConnectionName?: string
      ports: Array<{ x: number; y: number; z: number }>
    }
  >()

  for (const pp of nodeWithPortPoints.portPoints) {
    let entry = portsByConnection.get(pp.connectionName)
    if (!entry) {
      entry = { rootConnectionName: pp.rootConnectionName, ports: [] }
      portsByConnection.set(pp.connectionName, entry)
    } else if (!entry.rootConnectionName && pp.rootConnectionName) {
      entry.rootConnectionName = pp.rootConnectionName
    }
    const bp = toBoardCoords(pp, nodeCenter, coordinateScale)
    entry.ports.push({ x: bp.x, y: bp.y, z: pp.z ?? 0 })
  }

  let hasForeignObstacles = false
  for (const [connectionName, info] of portsByConnection.entries()) {
    const foreign: LayeredBoardObstacle[] = []
    const sameNetSmdPads: LayeredBoardObstacle[] = []
    for (const obs of layeredObstacles) {
      if (
        isObstacleOnSameNet(
          obs,
          { connectionName, rootConnectionName: info.rootConnectionName },
          connMap,
        )
      ) {
        if (obs.__zLayers.length === 1 && !obs.isNonPlatedHole) {
          sameNetSmdPads.push(obs)
        }
      } else {
        foreign.push(obs)
      }
    }
    foreignObstaclesByConnection.set(connectionName, foreign)
    sameNetSmdPadsByConnection.set(connectionName, sameNetSmdPads)
    if (foreign.length > 0 || sameNetSmdPads.length > 0) {
      hasForeignObstacles = true
    }

    // Fixed port points on the node border cannot move; cap segment target only
    // if an input terminal itself already sits inside obstacleMargin.
    let fixedTerminalCap = obstacleMargin
    for (const port of info.ports) {
      for (const obs of foreign) {
        if (!obs.__zLayers.includes(port.z) && !obs.isNonPlatedHole) continue
        const d = pointToObstacleSignedDistance(port.x, port.y, obs)
        const gap = d.signedDistanceToEdge - traceWidth / 2
        if (gap < fixedTerminalCap) {
          fixedTerminalCap = gap - 1e-6
        }
      }
    }
    requiredGapByConnection.set(connectionName, fixedTerminalCap)
  }

  return {
    hasForeignObstacles,
    nodeCenter,
    physicalHalfW,
    physicalHalfH,
    coordinateScale,
    viaClearance,
    allowBlindAndBuriedVias,
    foreignObstaclesByConnection,
    sameNetSmdPadsByConnection,
    requiredGapByConnection,
  }
}

/**
 * Returns the minimum signed margin surplus (`actualGap - requiredGap`) across all
 * vias and segments in `polyLines` against foreign board obstacles (`>= 0` means valid).
 */
export const computeMinForeignObstacleSurplus = (params: {
  polyLines: PolyLine2[]
  context: PreparedNodeObstacleContext
  viaDiameter: number
  traceWidth: number
  obstacleMargin: number
  segmentMarginOverride?: number
}): number => {
  const {
    polyLines,
    context,
    viaDiameter,
    traceWidth,
    obstacleMargin,
    segmentMarginOverride,
  } = params
  if (!context.hasForeignObstacles) return Number.POSITIVE_INFINITY

  const viaRadius = viaDiameter / 2
  const traceRadius = traceWidth / 2
  const viaTarget = context.viaClearance
  let minSurplus = Number.POSITIVE_INFINITY

  for (const polyLine of polyLines) {
    const foreign =
      context.foreignObstaclesByConnection.get(polyLine.connectionName) ?? []
    const sameNetSmdPads =
      context.sameNetSmdPadsByConnection.get(polyLine.connectionName) ?? []
    if (foreign.length === 0 && sameNetSmdPads.length === 0) continue
    const baseSegmentTarget =
      context.requiredGapByConnection.get(polyLine.connectionName) ??
      obstacleMargin
    const segmentTarget =
      segmentMarginOverride !== undefined
        ? Math.min(baseSegmentTarget, segmentMarginOverride)
        : baseSegmentTarget

    for (const mPoint of polyLine.mPoints) {
      if (mPoint.z1 === mPoint.z2) continue
      const bp = toBoardCoords(
        mPoint,
        context.nodeCenter,
        context.coordinateScale,
      )
      for (const obs of foreign) {
        if (
          !viaOverlapsObstacleLayers(
            mPoint,
            obs,
            context.allowBlindAndBuriedVias,
          )
        ) {
          continue
        }
        const d = pointToObstacleSignedDistance(bp.x, bp.y, obs)
        const gap = d.signedDistanceToEdge - viaRadius
        minSurplus = Math.min(minSurplus, gap - viaTarget)
      }
      // Do not spill vias into connected single-layer SMD pads (via-in-pad).
      for (const pad of sameNetSmdPads) {
        if (
          !viaOverlapsObstacleLayers(
            mPoint,
            pad,
            context.allowBlindAndBuriedVias,
          )
        ) {
          continue
        }
        const d = pointToObstacleSignedDistance(bp.x, bp.y, pad)
        const gap = d.signedDistanceToEdge - viaRadius
        minSurplus = Math.min(minSurplus, gap)
      }
    }

    const fullPath = [polyLine.start, ...polyLine.mPoints, polyLine.end]
    for (let k = 0; k < fullPath.length - 1; k++) {
      const p1 = fullPath[k]!
      const p2 = fullPath[k + 1]!
      const segLayer = p1.z2
      const b1 = toBoardCoords(p1, context.nodeCenter, context.coordinateScale)
      const b2 = toBoardCoords(p2, context.nodeCenter, context.coordinateScale)
      for (const obs of foreign) {
        if (!obs.__zLayers.includes(segLayer) && !obs.isNonPlatedHole) continue
        const d = segmentToObstacleSignedDistance(b1.x, b1.y, b2.x, b2.y, obs)
        const gap = d.signedDistanceToEdge - traceRadius
        minSurplus = Math.min(minSurplus, gap - segmentTarget)
      }
    }
  }

  return minSurplus
}

/**
 * Checks that placed vias in `routes` clear foreign board obstacles by `viaClearance`.
 */
export const doRoutesClearForeignObstacleVias = (params: {
  routes: HighDensityIntraNodeRoute[]
  context: PreparedNodeObstacleContext
  defaultViaDiameter: number
  viaClearance?: number
  onlyCheckBoundaryOverhangVias?: boolean
}): boolean => {
  const { routes, context, defaultViaDiameter, onlyCheckBoundaryOverhangVias } =
    params
  if (!context.hasForeignObstacles) return true
  const viaClearance = params.viaClearance ?? context.viaClearance

  for (const route of routes) {
    if (route.vias.length === 0) continue
    const foreign =
      context.foreignObstaclesByConnection.get(route.connectionName) ?? []
    if (foreign.length === 0) continue
    const viaRadius = (route.viaDiameter ?? defaultViaDiameter) / 2

    for (const via of route.vias) {
      const bp = toBoardCoords(via, context.nodeCenter, context.coordinateScale)
      if (
        onlyCheckBoundaryOverhangVias &&
        Math.abs(bp.x - context.nodeCenter.x) + viaRadius <=
          context.physicalHalfW + 1e-6 &&
        Math.abs(bp.y - context.nodeCenter.y) + viaRadius <=
          context.physicalHalfH + 1e-6
      ) {
        continue
      }

      let minZ = Number.POSITIVE_INFINITY
      let maxZ = Number.NEGATIVE_INFINITY
      if (context.allowBlindAndBuriedVias) {
        for (const pt of route.route) {
          if (
            Math.abs(pt.x - via.x) <= 1e-6 &&
            Math.abs(pt.y - via.y) <= 1e-6
          ) {
            minZ = Math.min(minZ, pt.z)
            maxZ = Math.max(maxZ, pt.z)
          }
        }
      }
      for (const obs of foreign) {
        if (
          context.allowBlindAndBuriedVias &&
          !obs.isNonPlatedHole &&
          Number.isFinite(minZ) &&
          !obs.__zLayers.some((z) => z >= minZ && z <= maxZ)
        ) {
          continue
        }
        const d = pointToObstacleSignedDistance(bp.x, bp.y, obs)
        const gap = d.signedDistanceToEdge - viaRadius
        if (gap < viaClearance - 1e-6) return false
      }
    }
  }
  return true
}
