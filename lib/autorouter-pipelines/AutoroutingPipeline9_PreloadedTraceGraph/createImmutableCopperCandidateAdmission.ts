import { RbushIndex } from "lib/data-structures/RbushIndex"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { Obstacle, SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { getViaDimensions } from "lib/utils/getViaDimensions"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"

type Point = { x: number; y: number }
type CandidateObstacle = Omit<Obstacle, "type"> & { type: "rect" | "oval" }
type Copper = {
  traceId: string
  net: string
  position: number
  start: Point
  end: Point
  layers: number[]
  radius: number
  holeRadius: number
  kind: "wire" | "via"
}
type AdmissionParams = {
  srj: SimpleRouteJson
  connMap: ConnectivityMap
  initialMovableTraces: readonly SimplifiedPcbTrace[]
  immutableTraces: readonly SimplifiedPcbTrace[]
  peerTraces?: readonly SimplifiedPcbTrace[]
  includeMovableCopper?: boolean
  boardObstacles?: readonly CandidateObstacle[]
  canonicalOwnerByTraceId?: ReadonlyMap<string, string>
  generatedTraceIds?: ReadonlySet<string>
}

const getCopper = (
  traces: readonly SimplifiedPcbTrace[],
  srj: SimpleRouteJson,
  connMap: ConnectivityMap,
  canonicalOwnerByTraceId?: ReadonlyMap<string, string>,
): Copper[] => {
  const dimensions = getViaDimensions(srj)
  const copper: Copper[] = []
  for (const trace of traces) {
    const net = canonicalOwnerByTraceId
      ? canonicalOwnerByTraceId.get(trace.pcb_trace_id)
      : connMap.getNetConnectedToId(trace.connection_name)
    if (!net) throw new Error(`Copper trace "${trace.pcb_trace_id}" has no owner`)
    for (const [position, point] of trace.route.entries()) {
      const next = trace.route[position + 1]
      if (point.route_type === "via") {
        const from = mapLayerNameToZ(point.from_layer, srj.layerCount)
        const to = mapLayerNameToZ(point.to_layer, srj.layerCount)
        if (
          ![from, to].every(
            (z): boolean => Number.isInteger(z) && z >= 0 && z < srj.layerCount,
          )
        )
          throw new Error(
            "Immutable copper via endpoints must use real board layers",
          )
        const layers = srj.allowBlindAndBuriedVias
          ? (point.layers?.map((layer): number =>
              mapLayerNameToZ(layer, srj.layerCount),
            ) ??
            Array.from(
              { length: Math.abs(to - from) + 1 },
              (_, i): number => Math.min(from, to) + i,
            ))
          : Array.from({ length: srj.layerCount }, (_, i): number => i)
        const span = new Set(layers)
        if (
          !span.has(from) ||
          !span.has(to) ||
          span.size !== Math.max(...layers) - Math.min(...layers) + 1
        )
          throw new Error(
            "Immutable copper via span must be contiguous and include both endpoints",
          )
        copper.push({
          traceId: trace.pcb_trace_id,
          net,
          position,
          start: point,
          end: point,
          layers,
          radius: (point.via_diameter ?? dimensions.padDiameter) / 2,
          holeRadius: (point.via_hole_diameter ?? dimensions.holeDiameter) / 2,
          kind: "via",
        })
      } else if (
        point.route_type === "wire" &&
        next?.route_type === "wire" &&
        point.layer === next.layer
      ) {
        copper.push({
          traceId: trace.pcb_trace_id,
          net,
          position,
          start: point,
          end: next,
          layers: [mapLayerNameToZ(point.layer, srj.layerCount)],
          radius: point.width / 2,
          holeRadius: 0,
          kind: "wire",
        })
      } else if (point.route_type === "through_obstacle") {
        const from = mapLayerNameToZ(point.from_layer, srj.layerCount)
        const to = mapLayerNameToZ(point.to_layer, srj.layerCount)
        copper.push({
          traceId: trace.pcb_trace_id,
          net,
          position,
          start: point.start,
          end: point.end,
          layers: Array.from(
            { length: Math.abs(to - from) + 1 },
            (_, i): number => Math.min(from, to) + i,
          ),
          radius: point.width / 2,
          holeRadius: 0,
          kind: "wire",
        })
      }
    }
  }
  for (const part of copper) {
    if (
      ![
        part.start.x,
        part.start.y,
        part.end.x,
        part.end.y,
        part.radius,
        part.holeRadius,
      ].every(Number.isFinite) ||
      part.radius <= 0 ||
      part.holeRadius < 0 ||
      part.holeRadius >= part.radius ||
      part.layers.length === 0 ||
      part.layers.some(
        (z): boolean => !Number.isInteger(z) || z < 0 || z >= srj.layerCount,
      )
    ) {
      throw new Error(`Copper primitive in "${part.traceId}" is invalid`)
    }
  }
  return copper
}

const getCopperGap = (left: Copper, right: Copper): number => {
  if (left.kind === "wire" && right.kind === "wire") {
    return (
      minimumDistanceBetweenSegments(
        left.start,
        left.end,
        right.start,
        right.end,
      ) -
      left.radius -
      right.radius
    )
  }
  if (left.kind === "via" && right.kind === "via") {
    const distance = Math.hypot(
      left.start.x - right.start.x,
      left.start.y - right.start.y,
    )
    const outside = distance - left.radius - right.radius
    const insideLeft = left.holeRadius - distance - right.radius
    const insideRight = right.holeRadius - distance - left.radius
    return Math.max(outside, insideLeft, insideRight)
  }
  const via = left.kind === "via" ? left : right
  const wire = left.kind === "wire" ? left : right
  const minimumRadius = Math.max(
    0,
    minimumDistanceBetweenSegments(via.start, via.start, wire.start, wire.end) -
      wire.radius,
  )
  const maximumRadius =
    Math.max(
      Math.hypot(via.start.x - wire.start.x, via.start.y - wire.start.y),
      Math.hypot(via.start.x - wire.end.x, via.start.y - wire.end.y),
    ) + wire.radius
  if (minimumRadius >= via.radius) return minimumRadius - via.radius
  if (maximumRadius <= via.holeRadius) return via.holeRadius - maximumRadius
  return -Math.min(maximumRadius - via.holeRadius, via.radius - minimumRadius)
}

/** Admit candidates against the actual retained copper, before repair ranking. */
export const createImmutableCopperCandidateAdmission = ({
  srj,
  connMap,
  initialMovableTraces,
  immutableTraces,
  peerTraces = [],
  includeMovableCopper = false,
  boardObstacles = [],
  canonicalOwnerByTraceId,
  generatedTraceIds,
}: AdmissionParams): ((
  traces: readonly SimplifiedPcbTrace[],
  checkMovableCopper?: boolean,
) => boolean) => {
  const immutable = getCopper(
    immutableTraces,
    srj,
    connMap,
    canonicalOwnerByTraceId,
  )
  const peers = getCopper(peerTraces, srj, connMap, canonicalOwnerByTraceId)
  const traceClearance = srj.minTraceToPadEdgeClearance ?? 0.1
  const viaClearance = srj.minPadEdgeToPadEdgeClearance ?? 0.1
  const holeClearance = srj.minViaHoleEdgeToViaHoleEdgeClearance ?? 0.1
  const traceHoleClearance = srj.minTraceToHoleEdgeClearance ?? traceClearance
  if (
    ![
      traceClearance,
      viaClearance,
      holeClearance,
      traceHoleClearance,
      srj.minViaEdgeToPadEdgeClearance ?? viaClearance,
    ].every((v): boolean => Number.isFinite(v) && v >= 0)
  )
    throw new Error("Immutable copper clearances must be finite and nonnegative")
  const obstacles = boardObstacles.map((obstacle, index) => {
    if (obstacle.type !== "rect" && obstacle.type !== "oval")
      throw new Error("Candidate obstacle has unsupported physical geometry")
    if (
      ![
        obstacle.center.x,
        obstacle.center.y,
        obstacle.width,
        obstacle.height,
        obstacle.ccwRotationDegrees ?? 0,
      ].every(Number.isFinite) ||
      obstacle.width <= 0 ||
      obstacle.height <= 0 ||
      (obstacle.isNonPlatedHole && obstacle.connectedTo.length > 0)
    )
      throw new Error("Candidate obstacle geometry or ownership is invalid")
    const layers =
      obstacle.__zLayers ??
      obstacle.zLayers ??
      obstacle.layers.map((layer): number =>
        mapLayerNameToZ(layer, srj.layerCount),
      )
    if (
      layers.length === 0 ||
      layers.some(
        (z): boolean => !Number.isInteger(z) || z < 0 || z >= srj.layerCount,
      )
    )
      throw new Error("Candidate obstacle has invalid physical layers")
    if (
      obstacle.shape === "circle" &&
      Math.abs(obstacle.width - obstacle.height) > 1e-8
    )
      throw new Error("A circular candidate obstacle must have equal diameters")
    const radius =
      obstacle.shape === "circle"
        ? obstacle.width / 2
        : obstacle.type === "oval"
          ? Math.min(obstacle.width, obstacle.height) / 2
          : undefined
    const halfSpine =
      obstacle.type === "oval" && obstacle.shape !== "circle"
        ? Math.abs(obstacle.width - obstacle.height) / 2
        : 0
    const spineStart = {
      x: obstacle.width >= obstacle.height ? -halfSpine : 0,
      y: obstacle.width < obstacle.height ? -halfSpine : 0,
    }
    const spineEnd = { x: -spineStart.x, y: -spineStart.y }
    const radians = (-(obstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180
    const cosine = Math.cos(radians)
    const sine = Math.sin(radians)
    return {
      obstacle,
      index,
      layers,
      radius,
      spineStart,
      spineEnd,
      nets: new Set(
        obstacle.connectedTo.map(
          (id): string => connMap.getNetConnectedToId(id) ?? id,
        ),
      ),
      local: (point: Point): Point => {
        const x = point.x - obstacle.center.x
        const y = point.y - obstacle.center.y
        return { x: x * cosine - y * sine, y: x * sine + y * cosine }
      },
    }
  })
  const maximumClearance = Math.max(
    traceClearance,
    viaClearance,
    holeClearance,
    traceHoleClearance,
    srj.minViaEdgeToPadEdgeClearance ?? viaClearance,
  )
  const indexCopper = (parts: readonly Copper[]): RbushIndex<Copper> => {
    const index = new RbushIndex<Copper>()
    index.bulkLoad(
      parts.map((part) => ({
        item: part,
        minX: Math.min(part.start.x, part.end.x) - part.radius,
        minY: Math.min(part.start.y, part.end.y) - part.radius,
        maxX: Math.max(part.start.x, part.end.x) + part.radius,
        maxY: Math.max(part.start.y, part.end.y) + part.radius,
      })),
    )
    return index
  }
  const immutableIndex = indexCopper(immutable)
  const peerIndex = indexCopper(peers)
  const obstacleIndex = new RbushIndex<(typeof obstacles)[number]>()
  obstacleIndex.bulkLoad(
    obstacles.map((part) => {
      const extent = Math.hypot(part.obstacle.width, part.obstacle.height) / 2
      return {
        item: part,
        minX: part.obstacle.center.x - extent,
        minY: part.obstacle.center.y - extent,
        maxX: part.obstacle.center.x + extent,
        maxY: part.obstacle.center.y + extent,
      }
    }),
  )
  const physicalKey = (part: Copper): string =>
    JSON.stringify([
      part.traceId,
      part.net,
      part.kind,
      part.layers,
      part.start.x,
      part.start.y,
      part.end.x,
      part.end.y,
      part.radius,
      part.holeRadius,
    ])
  const exactKeyByKey = new Map<string, string>()
  const violations = (
    traces: readonly SimplifiedPcbTrace[],
    checkMovableCopper: boolean,
  ): Map<string, number> => {
    const result = new Map<string, number>()
    exactKeyByKey.clear()
    const movable = getCopper(traces, srj, connMap, canonicalOwnerByTraceId)
    const partsByTrace = new Map<string, Copper[]>()
    for (const part of movable) {
      const parts = partsByTrace.get(part.traceId) ?? []
      parts.push(part)
      partsByTrace.set(part.traceId, parts)
    }
    const topologyByTrace = new Map(
      [...partsByTrace].map(([id, parts]): [string, string] => [
        id,
        JSON.stringify(
          parts.map((part) => [
            part.position,
            part.kind,
            [...part.layers].sort(),
          ]),
        ),
      ]),
    )
    const movableIndex = checkMovableCopper ? indexCopper(movable) : undefined
    const order = new Map(
      movable.map((part, index): [Copper, number] => [part, index]),
    )
    for (const [movingIndex, moving] of movable.entries()) {
      const padding = moving.radius + maximumClearance
      const minX = Math.min(moving.start.x, moving.end.x) - padding
      const minY = Math.min(moving.start.y, moving.end.y) - padding
      const maxX = Math.max(moving.start.x, moving.end.x) + padding
      const maxY = Math.max(moving.start.y, moving.end.y) + padding
      const neighboringCopper = [
        ...immutableIndex.search(minX, minY, maxX, maxY).map((fixed) => ({
          fixed,
          immutable: true,
        })),
        ...(checkMovableCopper
          ? peerIndex.search(minX, minY, maxX, maxY).map((fixed) => ({
              fixed,
              immutable: false,
            }))
          : []),
        ...(movableIndex
          ?.search(minX, minY, maxX, maxY)
          .filter((part): boolean => order.get(part)! > movingIndex)
          .map((fixed) => ({ fixed, immutable: false })) ?? []),
      ]
      for (const { fixed, immutable: isImmutable } of neighboringCopper) {
        const movingGenerated = generatedTraceIds?.has(moving.traceId) === true
        const fixedGenerated = generatedTraceIds?.has(fixed.traceId) === true
        if (!isImmutable && movingGenerated && fixedGenerated) continue
        const unfinishedPeer =
          !isImmutable && (movingGenerated || fixedGenerated)
        if (!moving.layers.some((z): boolean => fixed.layers.includes(z))) continue
        const reach =
          moving.radius +
          fixed.radius +
          Math.max(traceClearance, viaClearance, holeClearance, traceHoleClearance)
        if (
          Math.max(moving.start.x, moving.end.x) + reach <
            Math.min(fixed.start.x, fixed.end.x) ||
          Math.min(moving.start.x, moving.end.x) - reach >
            Math.max(fixed.start.x, fixed.end.x) ||
          Math.max(moving.start.y, moving.end.y) + reach <
            Math.min(fixed.start.y, fixed.end.y) ||
          Math.min(moving.start.y, moving.end.y) - reach >
            Math.max(fixed.start.y, fixed.end.y)
        )
          continue
        // Dirty geometry inherits permission only for the same primitive topology.
        const key = JSON.stringify([
          moving.traceId,
          moving.position,
          moving.kind,
          topologyByTrace.get(moving.traceId),
          fixed.traceId,
          fixed.position,
          fixed.kind,
          topologyByTrace.get(fixed.traceId),
        ])
        const unchangedKey = JSON.stringify([
          physicalKey(moving),
          physicalKey(fixed),
        ])
        const record = (constraint: "copper" | "hole", severity: number): void => {
          if (severity <= 1e-8) return
          const constraintKey = `${key}:${constraint}`
          result.set(
            constraintKey,
            Math.max(severity, result.get(constraintKey) ?? 0),
          )
          const exactKey = `exact:${unchangedKey}:${constraint}`
          result.set(exactKey, Math.max(severity, result.get(exactKey) ?? 0))
          exactKeyByKey.set(constraintKey, exactKey)
        }
        if (moving.net !== fixed.net) {
          const clearance = unfinishedPeer
            ? 0
            : moving.kind === "via" && fixed.kind === "via"
              ? viaClearance
              : traceClearance
          record("copper", clearance - getCopperGap(moving, fixed))
          if (moving.kind !== fixed.kind) {
            const via = moving.kind === "via" ? moving : fixed
            const wire = moving.kind === "wire" ? moving : fixed
            const gap =
              minimumDistanceBetweenSegments(
                via.start,
                via.start,
                wire.start,
                wire.end,
              ) -
              via.holeRadius -
              wire.radius
            record("hole", -gap)
          }
        }
        if (moving.kind === "via" && fixed.kind === "via") {
          const distance = Math.hypot(
            moving.start.x - fixed.start.x,
            moving.start.y - fixed.start.y,
          )
          if (!(moving.net === fixed.net && distance <= 1e-9))
            record(
              "hole",
              holeClearance - (distance - moving.holeRadius - fixed.holeRadius),
            )
        }
      }
      for (const {
        obstacle,
        index,
        layers,
        nets,
        local,
        radius,
        spineStart,
        spineEnd,
      } of obstacleIndex.search(minX, minY, maxX, maxY)) {
        if (
          !moving.layers.some((z): boolean => layers.includes(z)) ||
          (!obstacle.isNonPlatedHole && nets.has(moving.net))
        )
          continue
        const clearance =
          moving.kind === "via"
            ? (srj.minViaEdgeToPadEdgeClearance ?? viaClearance)
            : obstacle.isNonPlatedHole
              ? traceHoleClearance
              : traceClearance
        const reach =
          Math.hypot(obstacle.width, obstacle.height) / 2 +
          moving.radius +
          clearance
        if (
          Math.max(moving.start.x, moving.end.x) + reach < obstacle.center.x ||
          Math.min(moving.start.x, moving.end.x) - reach > obstacle.center.x ||
          Math.max(moving.start.y, moving.end.y) + reach < obstacle.center.y ||
          Math.min(moving.start.y, moving.end.y) - reach > obstacle.center.y
        )
          continue
        const start = local(moving.start)
        const end = local(moving.end)
        const halfWidth = obstacle.width / 2
        const halfHeight = obstacle.height / 2
        const corners = [
          { x: -halfWidth, y: -halfHeight },
          { x: halfWidth, y: -halfHeight },
          { x: halfWidth, y: halfHeight },
          { x: -halfWidth, y: halfHeight },
        ]
        const inside = (point: Point): boolean =>
          Math.abs(point.x) <= halfWidth && Math.abs(point.y) <= halfHeight
        const distance =
          radius !== undefined
            ? Math.max(
                0,
                minimumDistanceBetweenSegments(
                  start,
                  end,
                  spineStart,
                  spineEnd,
                ) - radius,
              )
            : inside(start) || inside(end)
              ? 0
              : Math.min(
                  ...corners.map((point, i): number =>
                    minimumDistanceBetweenSegments(
                      start,
                      end,
                      point,
                      corners[(i + 1) % corners.length]!,
                    ),
                  ),
                )
        let gap = distance - moving.radius
        if (
          moving.kind === "via" &&
          moving.holeRadius > 0 &&
          !obstacle.isNonPlatedHole
        ) {
          const farthest =
            radius !== undefined
              ? Math.max(
                  Math.hypot(start.x - spineStart.x, start.y - spineStart.y),
                  Math.hypot(start.x - spineEnd.x, start.y - spineEnd.y),
                ) + radius
              : Math.max(
                  ...corners.map((point): number =>
                    Math.hypot(start.x - point.x, start.y - point.y),
                  ),
                )
          gap = Math.max(gap, moving.holeRadius - farthest)
        }
        const severity = clearance - gap
        if (severity <= 1e-8) continue
        const key = JSON.stringify([
          moving.traceId,
          moving.position,
          moving.kind,
          topologyByTrace.get(moving.traceId),
          "obstacle",
          index,
        ])
        result.set(key, Math.max(severity, result.get(key) ?? 0))
        const exactKey = `exact:${physicalKey(moving)}:obstacle:${index}`
        result.set(exactKey, severity)
        exactKeyByKey.set(key, exactKey)
      }
    }
    return result
  }
  const initial = violations(initialMovableTraces, includeMovableCopper)
  return (traces, checkMovableCopper = includeMovableCopper): boolean => {
    for (const [key, severity] of violations(traces, checkMovableCopper)) {
      if (key.startsWith("exact:")) continue
      const originalSeverity = initial.get(key)
      if (originalSeverity === undefined || severity > originalSeverity + 1e-8) {
        // An exact physical primitive may survive a splice at a new position.
        // It retains only its own unchanged constraint, never a net-wide budget.
        const inherited = initial.get(exactKeyByKey.get(key) ?? key)
        if (inherited !== undefined && severity <= inherited + 1e-8) continue
        return false
      }
    }
    return true
  }
}
