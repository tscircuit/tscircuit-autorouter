import { checkViaTraceClearance } from "@tscircuit/checks"
import type { AnyCircuitElement, PcbTrace, PcbVia } from "circuit-json"
import { areDrcCopperPairIdentifiersUnambiguous } from "./areDrcCopperPairIdentifiersUnambiguous"

type ViaTraceClearanceOptions = NonNullable<
  Parameters<typeof checkViaTraceClearance>[1]
>
type ViaTraceClearanceErrors = ReturnType<typeof checkViaTraceClearance>
type CopperBounds = {
  minX: number
  maxX: number
  minY: number
  maxY: number
}
type TraceCopper = {
  trace: PcbTrace
  bounds: CopperBounds | undefined
  maxRadius: number
  segmentCount: number
}

export type PreparedViaTraceClearanceCheckerStats = {
  evaluationCount: number
  partitionedEvaluationCount: number
  nativeInvocationCount: number
  // Pair counts describe eligible partitioned evaluations, before/after the
  // conservative geometric query. General native calls do not guess bounds.
  totalViaTracePairCount: number
  selectedViaTracePairCount: number
  totalViaSegmentPairCount: number
  selectedViaSegmentPairCount: number
}

export type PreparedViaTraceClearanceChecker = {
  (
    circuitJson: AnyCircuitElement[],
    options?: ViaTraceClearanceOptions,
  ): ViaTraceClearanceErrors
  getStats: () => Readonly<PreparedViaTraceClearanceCheckerStats>
}

const getTraceCopper = (trace: PcbTrace): TraceCopper | undefined => {
  let bounds: CopperBounds | undefined
  let maxRadius = 0
  let segmentCount = 0
  for (let index = 0; index < trace.route.length - 1; index++) {
    const start = trace.route[index]!
    const end = trace.route[index + 1]!
    if (
      start.route_type !== "wire" ||
      end.route_type !== "wire" ||
      start.layer !== end.layer
    ) {
      continue
    }
    // Native clearance uses the starting wire's width for the entire segment.
    // Missing/invalid widths use its general computation, never guessed bounds.
    if (
      !Number.isFinite(start.x) ||
      !Number.isFinite(start.y) ||
      !Number.isFinite(end.x) ||
      !Number.isFinite(end.y) ||
      !Number.isFinite(start.width) ||
      start.width < 0
    ) {
      return undefined
    }
    const dx = end.x - start.x
    const dy = end.y - start.y
    const squaredLength = dx * dx + dy * dy
    if (
      !Number.isFinite(squaredLength) ||
      (squaredLength === 0 && (dx !== 0 || dy !== 0))
    ) {
      return undefined
    }
    const radius = start.width / 2
    // Native projection reconstructs start + t * (end - start). Cancellation
    // can put its t=1 point beyond the declared endpoint, so include both.
    // With finite arithmetic, every clamped t is inside this centerline box.
    const segmentBounds = {
      minX: Math.min(start.x, end.x, start.x + dx),
      maxX: Math.max(start.x, end.x, start.x + dx),
      minY: Math.min(start.y, end.y, start.y + dy),
      maxY: Math.max(start.y, end.y, start.y + dy),
    }
    if (!Object.values(segmentBounds).every(Number.isFinite)) return undefined
    bounds = bounds
      ? {
          minX: Math.min(bounds.minX, segmentBounds.minX),
          maxX: Math.max(bounds.maxX, segmentBounds.maxX),
          minY: Math.min(bounds.minY, segmentBounds.minY),
          maxY: Math.max(bounds.maxY, segmentBounds.maxY),
        }
      : segmentBounds
    maxRadius = Math.max(maxRadius, radius)
    segmentCount++
  }
  return { trace, bounds, maxRadius, segmentCount }
}

const getViaCenterBounds = (via: PcbVia): CopperBounds | undefined => {
  if (
    !Number.isFinite(via.x) ||
    !Number.isFinite(via.y) ||
    !Number.isFinite(via.outer_diameter) ||
    via.outer_diameter < 0
  ) {
    return undefined
  }
  return {
    minX: via.x,
    maxX: via.x,
    minY: via.y,
    maxY: via.y,
  }
}

const canTraceHaveViaClearanceError = (
  copper: TraceCopper,
  via: PcbVia,
  minClearance: number,
): boolean => {
  if (copper.bounds === undefined) return false
  const { minX, maxX, minY, maxY } = copper.bounds
  const x = Math.max(minX, Math.min(maxX, via.x))
  const y = Math.max(minY, Math.min(maxY, via.y))
  const dx = x - via.x
  const dy = y - via.y
  // Use the native circle-distance operation order on the closest box point.
  // Monotonic floating-point arithmetic makes this a lower bound for every
  // complete segment's gap. Subtracting the largest native segment radius is
  // conservative; no inversely rounded expanded face or tolerance is needed.
  const lowerGap =
    Math.max(0, Math.sqrt(dx * dx + dy * dy) - via.outer_diameter / 2) -
    copper.maxRadius
  return !(lowerGap >= minClearance)
}

const hasFiniteNativeDistanceArithmetic = (
  traces: TraceCopper[],
  vias: Array<{ via: PcbVia; bounds: CopperBounds }>,
): boolean => {
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const { bounds } of [...traces, ...vias]) {
    if (bounds === undefined) continue
    minX = Math.min(minX, bounds.minX)
    maxX = Math.max(maxX, bounds.maxX)
    minY = Math.min(minY, bounds.minY)
    maxY = Math.max(maxY, bounds.maxY)
  }
  if (minX === Number.POSITIVE_INFINITY) return true
  const dx = maxX - minX
  const dy = maxY - minY
  // Native segment/circle math squares lengths and forms dot products. Finite
  // coordinates alone are insufficient. Twice the complete-domain diagonal
  // bounds those intermediate vectors without overflow; unsafe inputs retain
  // native NaN/Infinity behavior through the unchanged general computation.
  return Number.isFinite(4 * (dx * dx + dy * dy))
}

/** Partitions only provably independent pairs; native checks produce every error. */
export const createPreparedViaTraceClearanceChecker =
  (): PreparedViaTraceClearanceChecker => {
    const stats: PreparedViaTraceClearanceCheckerStats = {
      evaluationCount: 0,
      partitionedEvaluationCount: 0,
      nativeInvocationCount: 0,
      totalViaTracePairCount: 0,
      selectedViaTracePairCount: 0,
      totalViaSegmentPairCount: 0,
      selectedViaSegmentPairCount: 0,
    }
    return Object.assign(
      (
        circuitJson: AnyCircuitElement[],
        options: ViaTraceClearanceOptions = {},
      ): ViaTraceClearanceErrors => {
        stats.evaluationCount++
        const { connMap, minClearance } = options
        if (
          connMap == null ||
          minClearance === undefined ||
          !Number.isFinite(minClearance) ||
          minClearance < 0 ||
          !areDrcCopperPairIdentifiersUnambiguous(circuitJson)
        ) {
          stats.nativeInvocationCount++
          return checkViaTraceClearance(circuitJson, options)
        }
        const traces: TraceCopper[] = []
        const vias: Array<{ via: PcbVia; bounds: CopperBounds }> = []
        for (const element of circuitJson) {
          if (element.type === "pcb_trace") {
            const copper = getTraceCopper(element)
            if (copper === undefined) {
              stats.nativeInvocationCount++
              return checkViaTraceClearance(circuitJson, options)
            }
            traces.push(copper)
          } else if (element.type === "pcb_via") {
            const bounds = getViaCenterBounds(element)
            if (bounds === undefined) {
              stats.nativeInvocationCount++
              return checkViaTraceClearance(circuitJson, options)
            }
            vias.push({ via: element, bounds })
          }
        }
        if (!hasFiniteNativeDistanceArithmetic(traces, vias)) {
          stats.nativeInvocationCount++
          return checkViaTraceClearance(circuitJson, options)
        }
        stats.partitionedEvaluationCount++
        stats.totalViaTracePairCount += vias.length * traces.length
        stats.totalViaSegmentPairCount +=
          vias.length *
          traces.reduce((count, trace) => count + trace.segmentCount, 0)
        const errors: ViaTraceClearanceErrors = []
        for (const { via } of vias) {
          const selectedTraces = new Set<PcbTrace>()
          for (const copper of traces) {
            if (!canTraceHaveViaClearanceError(copper, via, minClearance)) {
              continue
            }
            selectedTraces.add(copper.trace)
            stats.selectedViaSegmentPairCount += copper.segmentCount
          }
          stats.selectedViaTracePairCount += selectedTraces.size
          if (selectedTraces.size === 0) continue
          // Stable filtering preserves first-primary-ID readable-name lookup,
          // including non-copper IDs shadowing a via/trace. Keep all metadata.
          // Complete traces preserve pair-wide contact suppression, minimum
          // gap, endpoint-derived names and the native whole-trace midpoint.
          const partition = circuitJson.filter((element) => {
            if (element.type === "pcb_via") return element === via
            if (element.type === "pcb_trace") return selectedTraces.has(element)
            return true
          })
          stats.nativeInvocationCount++
          errors.push(...checkViaTraceClearance(partition, options))
        }
        // Unique official pair keys make each via's error group independent.
        // Encounter-order concatenation retains the native Map insertion order.
        return errors
      },
      {
        getStats: (): Readonly<PreparedViaTraceClearanceCheckerStats> => ({
          ...stats,
        }),
      },
    )
  }
