// Adapted from @tscircuit/checks 0.0.233; see LICENSE and PROVENANCE.md.
import { checkViaTraceClearance } from "@tscircuit/checks"
import { getReadableNameForElement } from "@tscircuit/circuit-json-util"
import { segmentToCircleMinDistance } from "@tscircuit/math-utils"
import type { AnyCircuitElement, PcbVia, PcbViaTraceClearanceError } from "circuit-json"
import { formatMm } from "format-si-unit"
import { type ConnectivityMap, getFullConnectivityMapFromCircuitJson } from "circuit-json-to-connectivity-map"
import { getViaTraceAxisBounds, getViaTraceAxisQuery, isViaTraceAxisSeparated } from "./getViaTraceAxisBounds"
import { canUseLazyViaTraceCenters } from "./canUseLazyViaTraceCenters"
import { EPSILON, getBoardDrcValue, getPcbBoard } from "./native/lib/drc-defaults"
import { jlcMinTolerances } from "./native/lib/jlcpcb-manufacturing-specs"
import { getLayersOfPcbElement } from "./native/lib/util/getLayersOfPcbElement"
import { getTraceObstacleClearance, getTraceSegments, isTraceObstacleOverlap } from "./native/lib/check-pad-clearance/common"

export type LazyViaTraceCenterDiagnostics = {
  eligibleChecks: number
  nativeChecks: number
  gapCalls: number
  centerCalls: number
  axisRejected?: number
  connectivityQueries?: number
  connectivityHits?: number
}

export function checkViaTraceClearanceWithLazyCenters(
  circuitJson: AnyCircuitElement[],
  { connMap, minClearance, diagnostics, enableAxisRejection = false, enableConnectivityMemo = false }: {
    connMap?: ConnectivityMap
    minClearance?: number
    diagnostics?: LazyViaTraceCenterDiagnostics
    enableAxisRejection?: boolean
    enableConnectivityMemo?: boolean
  } = {},
): PcbViaTraceClearanceError[] {
  if (!canUseLazyViaTraceCenters(circuitJson, connMap, minClearance)) {
    if (diagnostics) diagnostics.nativeChecks++
    return checkViaTraceClearance(circuitJson, { connMap, minClearance })
  }
  if (diagnostics) diagnostics.eligibleChecks++
  const vias = circuitJson.filter((el) => el.type === "pcb_via") as PcbVia[]
  const segments = getTraceSegments(circuitJson)
  if (vias.length === 0 || segments.length === 0) return []
  const board = getPcbBoard(circuitJson)
  minClearance ??= getBoardDrcValue(board, "min_trace_to_pad_edge_clearance") ?? jlcMinTolerances.min_trace_to_pad_edge_clearance
  connMap ??= getFullConnectivityMapFromCircuitJson(circuitJson)
  const axisBounds = enableAxisRejection ? segments.map(getViaTraceAxisBounds) : undefined
  const errors = new Map<string, { error: PcbViaTraceClearanceError; gap: number }>()
  const overlappingPairIds = new Set<string>()
  // No graph or geometry can change inside this synchronous descriptor-verified
  // native call. Cache successful native decisions only, at their first query site.
  const connectivityByVia = enableConnectivityMemo ? new Map<string, Map<string, boolean>>() : undefined
  for (const via of vias) {
    let connectedByTrace: Map<string, boolean> | undefined
    if (connectivityByVia) {
      connectedByTrace = connectivityByVia.get(via.pcb_via_id)
      if (!connectedByTrace) {
        connectedByTrace = new Map<string, boolean>()
        connectivityByVia.set(via.pcb_via_id, connectedByTrace)
      }
    }
    let previousTraceId: string | undefined
    let previousConnected = false
    // Admission proves plain layer arrays and native array methods. Retain the
    // original array only when no diagnostics callback can change it mid-call;
    // missing layers keep the original all_layers clone at every query site.
    const retainedLayers = diagnostics === undefined && Array.isArray(via.layers)
      ? via.layers
      : undefined
    const axisQuery = enableAxisRejection ? getViaTraceAxisQuery(via, minClearance!) : undefined
    for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
      const segment = segments[segmentIndex]!
      if (!(retainedLayers ?? getLayersOfPcbElement(via)).includes(segment.layer)) continue
      let connected: boolean | undefined
      if (connectedByTrace) {
        // Native segment lists usually contain consecutive segments of one
        // trace. Reuse that same pair without another string-map lookup.
        connected = segment.pcb_trace_id === previousTraceId ? previousConnected : connectedByTrace.get(segment.pcb_trace_id)
      }
      if (connected === undefined) {
        connected = connMap.areIdsConnected(segment.pcb_trace_id, via.pcb_via_id)
        connectedByTrace?.set(segment.pcb_trace_id, connected)
        if (diagnostics) diagnostics.connectivityQueries = (diagnostics.connectivityQueries ?? 0) + 1
      } else if (diagnostics) diagnostics.connectivityHits = (diagnostics.connectivityHits ?? 0) + 1
      previousTraceId = segment.pcb_trace_id
      previousConnected = connected
      if (connected) continue
      const bounds = axisBounds?.[segmentIndex]
      if (bounds && axisQuery && isViaTraceAxisSeparated(bounds, axisQuery)) {
        if (diagnostics) diagnostics.axisRejected = (diagnostics.axisRejected ?? 0) + 1
        continue
      }
      const pairId = `${via.pcb_via_id}_${segment.pcb_trace_id}`
      // Identical native gap arithmetic, without its unused closest-point marker.
      const gap = segmentToCircleMinDistance(
        { x: segment.x1, y: segment.y1 }, { x: segment.x2, y: segment.y2 },
        { x: via.x, y: via.y, radius: via.outer_diameter / 2 },
      ) - segment.thickness / 2
      if (diagnostics) diagnostics.gapCalls++
      if (isTraceObstacleOverlap(gap)) {
        errors.delete(pairId)
        overlappingPairIds.add(pairId)
        continue
      }
      if (overlappingPairIds.has(pairId)) continue
      if (gap + EPSILON >= minClearance!) continue
      // Use the original marker formula, freshly, at the original error publication.
      const { center } = getTraceObstacleClearance(segment, via)
      if (diagnostics) diagnostics.centerCalls++
      const nextError: PcbViaTraceClearanceError = {
        type: "pcb_via_trace_clearance_error",
        pcb_via_trace_clearance_error_id: `via_trace_clearance_${pairId}`,
        error_type: "pcb_via_trace_clearance_error",
        message: `Via ${getReadableNameForElement(circuitJson, via.pcb_via_id)} and trace ${getReadableNameForElement(circuitJson, segment.pcb_trace_id)} are too close (clearance: ${formatMm(gap)}, minimum: ${formatMm(minClearance!)})`,
        pcb_via_id: via.pcb_via_id,
        pcb_trace_id: segment.pcb_trace_id,
        minimum_clearance: minClearance,
        actual_clearance: gap,
        center,
      }
      const current = errors.get(pairId)
      if (!current || gap < current.gap) errors.set(pairId, { error: nextError, gap })
    }
  }
  return Array.from(errors.values()).map(({ error }) => error)
}
