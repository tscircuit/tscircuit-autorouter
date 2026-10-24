import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { RELAXED_DRC_OPTIONS } from "lib/testing/drcPresets"
import {
  combinePreloadedAndRoutedTraces,
  evaluateRelaxedDrc,
} from "lib/testing/evaluate-relaxed-drc"
import type {
  Obstacle,
  SimpleRouteConnection,
  SimpleRouteJson,
  SimplifiedPcbTrace,
  UnroutedConnectionIssue,
} from "lib/types/srj-types"
import { getDrcErrorTraceIds } from "./getDrcErrorTraceIds"
import { getPointToObstacleEdgeDistance } from "./viaKeepoutUtils"

const getSegmentToObstacleClosestPoint = (
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  obstacle: Obstacle,
): { distance: number; point: { x: number; y: number } } => {
  const dx = p2.x - p1.x
  const dy = p2.y - p1.y
  const lenSq = dx * dx + dy * dy
  const candidateTs = new Set<number>([0, 1])

  if (lenSq > 1e-12) {
    const rotationRadians =
      (-1 * (obstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180
    const cos = Math.cos(rotationRadians)
    const sin = Math.sin(rotationRadians)
    const toLocal = (pt: { x: number; y: number }) => {
      const ox = pt.x - obstacle.center.x
      const oy = pt.y - obstacle.center.y
      return {
        x: ox * cos - oy * sin,
        y: ox * sin + oy * cos,
      }
    }
    const l1 = toLocal(p1)
    const l2 = toLocal(p2)
    const ldx = l2.x - l1.x
    const ldy = l2.y - l1.y
    const lLenSq = ldx * ldx + ldy * ldy
    const hw = obstacle.width / 2
    const hh = obstacle.height / 2

    if (Math.abs(ldx) > 1e-9) {
      for (const targetX of [-hw, 0, hw]) {
        const t = (targetX - l1.x) / ldx
        if (t > 0 && t < 1) candidateTs.add(t)
      }
    }
    if (Math.abs(ldy) > 1e-9) {
      for (const targetY of [-hh, 0, hh]) {
        const t = (targetY - l1.y) / ldy
        if (t > 0 && t < 1) candidateTs.add(t)
      }
    }
    const corners = [
      { x: 0, y: 0 },
      { x: -hw, y: -hh },
      { x: -hw, y: hh },
      { x: hw, y: -hh },
      { x: hw, y: hh },
    ]
    for (const c of corners) {
      const t = ((c.x - l1.x) * ldx + (c.y - l1.y) * ldy) / lLenSq
      if (t > 0 && t < 1) candidateTs.add(t)
    }
  }

  let bestDistance = Number.POSITIVE_INFINITY
  let bestPoint = { x: p1.x, y: p1.y }
  for (const t of candidateTs) {
    const pt = { x: p1.x + dx * t, y: p1.y + dy * t }
    const d = getPointToObstacleEdgeDistance(pt, obstacle)
    if (d < bestDistance) {
      bestDistance = d
      bestPoint = pt
    }
  }
  return { distance: bestDistance, point: bestPoint }
}

const extractLocationFromDrcError = (
  error: Record<string, unknown>,
  trace?: SimplifiedPcbTrace,
): { x: number; y: number } => {
  const center = error.center ?? error.pcb_center
  if (
    center &&
    typeof center === "object" &&
    "x" in center &&
    "y" in center &&
    typeof (center as { x: unknown }).x === "number" &&
    typeof (center as { y: unknown }).y === "number"
  ) {
    return {
      x: (center as { x: number }).x,
      y: (center as { y: number }).y,
    }
  }
  const message = typeof error.message === "string" ? error.message : ""
  const coordMatch = message.match(
    /\((-?\d+(?:\.\d+)?)\s*(?:mm)?\s*,\s*(-?\d+(?:\.\d+)?)\s*(?:mm)?\)/i,
  )
  if (coordMatch) {
    return {
      x: Number.parseFloat(coordMatch[1]!),
      y: Number.parseFloat(coordMatch[2]!),
    }
  }
  if (trace && trace.route.length > 0) {
    const first = trace.route[0]!
    if ("x" in first && "y" in first) {
      return { x: first.x, y: first.y }
    }
    if ("start" in first) {
      return { x: first.start.x, y: first.start.y }
    }
  }
  return { x: 0, y: 0 }
}

const mapViaIdsToTraceIds = (
  circuitJson: ReadonlyArray<Record<string, unknown>>,
): Map<string, string> => {
  const traceIdByViaId = new Map<string, string>()
  for (const element of circuitJson) {
    if (
      element.type === "pcb_via" &&
      typeof element.pcb_via_id === "string" &&
      typeof element.pcb_trace_id === "string"
    ) {
      traceIdByViaId.set(element.pcb_via_id, element.pcb_trace_id)
    }
  }
  return traceIdByViaId
}

const extractAllTraceIdsFromError = (
  error: Record<string, unknown>,
  traceIdByViaId: ReadonlyMap<string, string>,
): string[] => {
  const directIds = getDrcErrorTraceIds(error)
  const viaIds = [
    ...(typeof error.pcb_via_id === "string" ? [error.pcb_via_id] : []),
    ...(Array.isArray(error.pcb_via_ids)
      ? error.pcb_via_ids.filter((id): id is string => typeof id === "string")
      : []),
    ...(Array.isArray(error.pcb_pad_ids)
      ? error.pcb_pad_ids.filter(
          (id): id is string =>
            typeof id === "string" && traceIdByViaId.has(id),
        )
      : []),
  ]
  const fromVias = viaIds.flatMap((viaId) => {
    const traceId = traceIdByViaId.get(viaId)
    return traceId ? [traceId] : []
  })
  return Array.from(new Set([...directIds, ...fromVias]))
}

export const collectUnroutedConnectionIssues = ({
  originalSrj,
  srjWithPointPairs,
  routedTraces,
  newConnections,
  connMap,
}: {
  originalSrj: SimpleRouteJson
  srjWithPointPairs: SimpleRouteJson
  routedTraces: SimplifiedPcbTrace[]
  newConnections?: SimpleRouteConnection[]
  connMap?: ConnectivityMap
}): {
  unroutedConnections: UnroutedConnectionIssue[]
  violatingTraceIds: Set<string>
  violatingConnectionNames: Set<string>
} => {
  const traceClearance =
    originalSrj.minTraceToPadEdgeClearance ??
    originalSrj.defaultObstacleMargin ??
    RELAXED_DRC_OPTIONS.traceClearance ??
    0.1
  const viaClearance =
    originalSrj.minViaHoleEdgeToViaHoleEdgeClearance ??
    RELAXED_DRC_OPTIONS.viaClearance ??
    0.1
  const viaToPadClearance = originalSrj.minViaEdgeToPadEdgeClearance

  const baselineDrc = evaluateRelaxedDrc({
    includeBoardClearance: true,
    inputSrj: originalSrj,
    srjWithPointPairs,
    routedTraces: [],
    drcOptions: {
      traceClearance,
      viaClearance,
      viaToPadClearance,
      includeTraceContinuity: false,
    },
  })
  const baselineErrorKeys = new Set(
    baselineDrc.errors.map((err) => {
      const e = err as unknown as Record<string, unknown>
      return String(
        e.pcb_trace_error_id ??
          e.pcb_pad_pad_clearance_error_id ??
          e.pcb_error_id ??
          e.message ??
          "",
      )
    }),
  )

  const evaluatedDrc = evaluateRelaxedDrc({
    includeBoardClearance: true,
    inputSrj: originalSrj,
    srjWithPointPairs,
    routedTraces,
    drcOptions: {
      traceClearance,
      viaClearance,
      viaToPadClearance,
      includeTraceContinuity: false,
    },
  })

  const traceIdByViaId = mapViaIdsToTraceIds(
    evaluatedDrc.circuitJson as unknown as ReadonlyArray<
      Record<string, unknown>
    >,
  )
  const combinedTraces = combinePreloadedAndRoutedTraces(
    originalSrj.traces ?? [],
    routedTraces,
  )
  const traceById = new Map(
    combinedTraces.map((trace) => [trace.pcb_trace_id, trace]),
  )
  const preloadedTraceIds = new Set(
    (originalSrj.traces ?? []).map((trace) => trace.pcb_trace_id),
  )
  const allConnections = [
    ...(newConnections ?? []),
    ...srjWithPointPairs.connections,
    ...originalSrj.connections,
  ]
  const connectionByName = new Map<string, SimpleRouteConnection>()
  for (const conn of allConnections) {
    if (!connectionByName.has(conn.name)) {
      connectionByName.set(conn.name, conn)
    }
  }

  const unroutedConnections: UnroutedConnectionIssue[] = []
  const violatingTraceIds = new Set<string>()
  const violatingConnectionNames = new Set<string>()
  const seenIssueKeys = new Set<string>()

  const allErrors = (evaluatedDrc.errorsWithCenters.length > 0
    ? evaluatedDrc.errorsWithCenters
    : evaluatedDrc.errors) as unknown as Array<Record<string, unknown>>

  for (const error of allErrors) {
    const errorKey = String(
      error.pcb_trace_error_id ??
        error.pcb_pad_pad_clearance_error_id ??
        error.pcb_error_id ??
        error.message ??
        "",
    )
    if (errorKey && baselineErrorKeys.has(errorKey)) {
      continue
    }

    const traceIds = extractAllTraceIdsFromError(error, traceIdByViaId)
    // Prefer attributing clearance violations to newly routed traces rather than preloaded traces
    const candidateTraceIds =
      traceIds.filter((id) => !preloadedTraceIds.has(id)).length > 0
        ? traceIds.filter((id) => !preloadedTraceIds.has(id))
        : traceIds

    for (const traceId of candidateTraceIds) {
      const trace = traceById.get(traceId)
      const connectionName = trace?.connection_name ?? traceId
      const conn = connectionByName.get(connectionName)
      const rootConnectionName =
        conn?.rootConnectionName ??
        conn?.__rootConnectionNames?.[0] ??
        conn?.__netConnectionName ??
        (connMap ? connMap.getNetConnectedToId(connectionName) : undefined)
      const sourceTraceId =
        conn?.source_trace_id ??
        conn?.__netConnectionName ??
        conn?.__rootConnectionNames?.[0] ??
        connectionName
      const location = extractLocationFromDrcError(error, trace)
      const errorType = String(
        error.error_type ?? error.type ?? "pcb_trace_error",
      )
      const reason =
        error.reason === "via_keepout_violation"
          ? "via_keepout_violation"
          : "clearance_violation"
      const actualClearance =
        typeof error.actual_clearance === "number"
          ? error.actual_clearance
          : undefined
      const minimumClearance =
        typeof error.minimum_clearance === "number"
          ? error.minimum_clearance
          : undefined
      const message =
        typeof error.message === "string"
          ? error.message
          : `Connection "${connectionName}" violates clearance at (${location.x.toFixed(3)}mm, ${location.y.toFixed(3)}mm)`

      violatingTraceIds.add(traceId)
      violatingConnectionNames.add(connectionName)
      if (rootConnectionName) {
        violatingConnectionNames.add(rootConnectionName)
      }

      const dedupeKey = `${connectionName}:${errorType}:${location.x.toFixed(3)}:${location.y.toFixed(3)}`
      if (seenIssueKeys.has(dedupeKey)) continue
      seenIssueKeys.add(dedupeKey)

      unroutedConnections.push({
        connectionName,
        rootConnectionName,
        sourceTraceId,
        pcbTraceId: trace?.pcb_trace_id ?? traceId,
        reason,
        errorType,
        location,
        actualClearance,
        minimumClearance,
        message,
      })
    }
  }

  // Also check direct geometric wire-to-obstacle clearance on routedTraces so
  // synthetic SRJs without circuitJsonMetadata on obstacles still report violations
  for (const trace of routedTraces) {
    if (violatingTraceIds.has(trace.pcb_trace_id)) continue
    const connectionName = trace.connection_name
    const conn =
      connectionByName.get(connectionName) ??
      originalSrj.connections.find((c) => c.name === connectionName)
    const rootConnectionName =
      conn?.rootConnectionName ??
      conn?.__rootConnectionNames?.[0] ??
      conn?.__netConnectionName ??
      (connMap ? connMap.getNetConnectedToId(connectionName) : undefined)
    const sourceTraceId =
      conn?.source_trace_id ??
      conn?.__netConnectionName ??
      conn?.__rootConnectionNames?.[0] ??
      connectionName

    const netRefIds = new Set(
      [
        connectionName,
        rootConnectionName,
        sourceTraceId,
        ...(conn?.pointsToConnect.flatMap((pt) => [
          pt.pointId,
          pt.pcb_port_id,
        ]) ?? []),
      ].filter((id): id is string => Boolean(id)),
    )

    let worstViolation: {
      actualClearance: number
      minimumClearance: number
      location: { x: number; y: number }
      errorType: string
      message: string
    } | null = null

    for (let i = 0; i + 1 < trace.route.length; i++) {
      const segA = trace.route[i]!
      const segB = trace.route[i + 1]!
      if (segA.route_type !== "wire" || segB.route_type !== "wire") continue
      if (segA.layer !== segB.layer) continue
      const layer = segA.layer
      const wireHalfWidth =
        Math.max(
          segA.width ?? originalSrj.minTraceWidth,
          segB.width ?? originalSrj.minTraceWidth,
        ) / 2

      for (const obstacle of originalSrj.obstacles) {
        if (obstacle.isViaKeepout) continue
        if (!obstacle.layers.includes(layer)) continue
        const obsIds = [
          ...(obstacle.connectedTo ?? []),
          ...(obstacle.offBoardConnectsTo ?? []),
        ]
        const isSameNet =
          obsIds.some(
            (id) =>
              netRefIds.has(id) ||
              Boolean(connMap?.areIdsConnected(connectionName, id)),
          ) ||
          (obsIds.length === 0 &&
            (conn?.pointsToConnect.some(
              (pt) =>
                ("layer" in pt ? pt.layer === layer : true) &&
                getPointToObstacleEdgeDistance(pt, obstacle) <= 1e-4,
            ) ??
              false))
        if (isSameNet) continue

        const requiredClearance = obstacle.isNonPlatedHole
          ? (originalSrj.minTraceToHoleEdgeClearance ?? traceClearance)
          : traceClearance
        const { distance: edgeDist, point } = getSegmentToObstacleClosestPoint(
          segA,
          segB,
          obstacle,
        )
        const actualClearance = edgeDist - wireHalfWidth
        if (actualClearance + 1e-4 < requiredClearance) {
          if (
            !worstViolation ||
            actualClearance < worstViolation.actualClearance
          ) {
            const errorType = obstacle.isNonPlatedHole
              ? "pcb_hole_trace_clearance_error"
              : "pcb_pad_trace_clearance_error"
            worstViolation = {
              actualClearance: Math.max(0, actualClearance),
              minimumClearance: requiredClearance,
              location: point,
              errorType,
              message: `${errorType} on ${connectionName} at (${point.x.toFixed(3)}mm, ${point.y.toFixed(3)}mm): actual clearance ${Math.max(0, actualClearance).toFixed(3)}mm < minimum ${requiredClearance.toFixed(3)}mm`,
            }
          }
        }
      }
    }

    if (worstViolation) {
      violatingTraceIds.add(trace.pcb_trace_id)
      violatingConnectionNames.add(connectionName)
      if (rootConnectionName) {
        violatingConnectionNames.add(rootConnectionName)
      }
      const dedupeKey = `${connectionName}:${worstViolation.errorType}:${worstViolation.location.x.toFixed(3)}:${worstViolation.location.y.toFixed(3)}`
      if (!seenIssueKeys.has(dedupeKey)) {
        seenIssueKeys.add(dedupeKey)
        unroutedConnections.push({
          connectionName,
          rootConnectionName,
          sourceTraceId,
          pcbTraceId: trace.pcb_trace_id,
          reason: "clearance_violation",
          errorType: worstViolation.errorType,
          location: worstViolation.location,
          actualClearance: worstViolation.actualClearance,
          minimumClearance: worstViolation.minimumClearance,
          message: worstViolation.message,
        })
      }
    }
  }

  return {
    unroutedConnections,
    violatingTraceIds,
    violatingConnectionNames,
  }
}
