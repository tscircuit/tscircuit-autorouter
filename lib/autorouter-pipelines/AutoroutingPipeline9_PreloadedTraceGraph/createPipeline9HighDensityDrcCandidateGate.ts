import {
  checkDifferentNetViaSpacing,
  checkEachPcbTraceNonOverlapping,
  checkPadTraceClearance,
  checkSameNetViaSpacing,
  checkViaTraceClearance,
} from "@tscircuit/checks"
import type { AnyCircuitElement, PcbTrace, PcbVia } from "circuit-json"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { RELAXED_TRACE_CLEARANCE } from "lib/testing/drcPresets"
import { MIN_VIA_TO_VIA_CLEARANCE } from "lib/testing/getDrcErrors"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { arePipeline9HighDensityDrcPairIdentifiersUnambiguous } from "./arePipeline9HighDensityDrcPairIdentifiersUnambiguous"
import {
  doPipeline9BoundsOverlap,
  type Pipeline9Bounds,
} from "./pipeline9FixedRouteCopper"
import type { Pipeline9DrcError } from "./pipeline9JointDrcRepairUtils"

export type Pipeline9HighDensityDrcSnapshot = {
  circuitJson: AnyCircuitElement[]
  connMap: ConnectivityMap
  normalizeErrors: (errors: Record<string, unknown>[]) => Pipeline9DrcError[]
}

export type Pipeline9HighDensityDrcCandidateGate = (params: {
  currentRoutes: HighDensityRoute[]
  candidateRoutes: HighDensityRoute[]
  changedTraceIds: ReadonlySet<string>
}) => {
  currentErrors: Pipeline9DrcError[]
  candidateErrors: Pipeline9DrcError[]
  candidateErrorPairsAreUnambiguous: boolean
  snapshotPreparationTimeMs?: number
  scopedCopperCheckTimeMs?: number
}

type SnapshotCopper = {
  traces: Map<string, PcbTrace>
  traceBounds: Map<string, Pipeline9Bounds>
  vias: PcbVia[]
}

type LocalBaseline = {
  contextKey: string
  errors: Pipeline9DrcError[]
}

const getTraceBounds = (trace: PcbTrace): Pipeline9Bounds | undefined => {
  let bounds: Pipeline9Bounds | undefined
  for (const [index, point] of trace.route.entries()) {
    if (point.route_type !== "wire" && point.route_type !== "via") continue
    const previousPoint = trace.route[index - 1]
    // Official wire segments use their starting point's width all the way to
    // the next endpoint, even if that endpoint declares a narrower next wire.
    const radius =
      point.route_type === "wire"
        ? Math.max(
            point.width,
            previousPoint?.route_type === "wire" &&
              previousPoint.layer === point.layer
              ? previousPoint.width
              : 0,
          ) / 2
        : 0
    const pointBounds = {
      minX: point.x - radius,
      maxX: point.x + radius,
      minY: point.y - radius,
      maxY: point.y + radius,
    }
    bounds = bounds
      ? {
          minX: Math.min(bounds.minX, pointBounds.minX),
          maxX: Math.max(bounds.maxX, pointBounds.maxX),
          minY: Math.min(bounds.minY, pointBounds.minY),
          maxY: Math.max(bounds.maxY, pointBounds.maxY),
        }
      : pointBounds
  }
  return bounds
}

const getViaBounds = (via: PcbVia): Pipeline9Bounds => {
  const radius = Math.max(via.outer_diameter, via.hole_diameter) / 2
  return {
    minX: via.x - radius,
    maxX: via.x + radius,
    minY: via.y - radius,
    maxY: via.y + radius,
  }
}

const evaluateScopedCopper = (
  snapshot: Pipeline9HighDensityDrcSnapshot,
  traceIds: ReadonlySet<string>,
  viaSites: ReadonlySet<string>,
): Pipeline9DrcError[] => {
  const circuitJson = snapshot.circuitJson.flatMap(
    (element): AnyCircuitElement[] => {
      if (element.type === "pcb_trace") {
        if (!traceIds.has(element.pcb_trace_id)) return []
        // The official overlap check fills missing endpoint port identities.
        // Keep the full conversion immutable for later full-board validation.
        return [
          {
            ...element,
            route: element.route.map((point) => ({ ...point })),
          },
        ]
      }
      if (
        element.type === "pcb_via" &&
        !viaSites.has(`${element.x},${element.y}`)
      ) {
        return []
      }
      // Preserve all pads and ports: endpoint inference must see the same
      // elements, in the same order, as the complete board's official check.
      return [element]
    },
  )
  const traceOptions = {
    connMap: snapshot.connMap,
    minClearance: RELAXED_TRACE_CLEARANCE,
  }
  const viaOptions = {
    connMap: snapshot.connMap,
    minClearance: MIN_VIA_TO_VIA_CLEARANCE,
  }
  const errors = [
    ...checkEachPcbTraceNonOverlapping(circuitJson, traceOptions),
    ...checkViaTraceClearance(circuitJson, traceOptions),
    ...checkPadTraceClearance(circuitJson, traceOptions),
    ...checkSameNetViaSpacing(circuitJson, viaOptions),
    ...checkDifferentNetViaSpacing(circuitJson, viaOptions),
  ]
  return snapshot.normalizeErrors(
    errors as unknown as Record<string, unknown>[],
  )
}

/** Exact pairwise copper comparison; promising trials still need a full check. */
export const createPipeline9HighDensityDrcCandidateGate = ({
  getSnapshot,
}: {
  getSnapshot: (routes: HighDensityRoute[]) => Pipeline9HighDensityDrcSnapshot
}): Pipeline9HighDensityDrcCandidateGate => {
  const copperBySnapshot = new WeakMap<
    Pipeline9HighDensityDrcSnapshot,
    SnapshotCopper
  >()
  const boundsByTrace = new WeakMap<PcbTrace, Pipeline9Bounds | undefined>()
  const baselineBySnapshot = new WeakMap<
    Pipeline9HighDensityDrcSnapshot,
    LocalBaseline
  >()
  const unambiguousPairsBySnapshot = new WeakMap<
    Pipeline9HighDensityDrcSnapshot,
    boolean
  >()
  const getCopper = (
    snapshot: Pipeline9HighDensityDrcSnapshot,
  ): SnapshotCopper => {
    const cached = copperBySnapshot.get(snapshot)
    if (cached) return cached
    const traces = new Map<string, PcbTrace>()
    const traceBounds = new Map<string, Pipeline9Bounds>()
    const vias: PcbVia[] = []
    for (const element of snapshot.circuitJson) {
      if (element.type === "pcb_trace") {
        traces.set(element.pcb_trace_id, element)
        // Snapshots borrow immutable converted traces. Only changed geometry
        // needs another vertex scan; immutable neighbour bounds stay exact.
        if (!boundsByTrace.has(element)) {
          boundsByTrace.set(element, getTraceBounds(element))
        }
        const bounds = boundsByTrace.get(element)
        if (bounds) traceBounds.set(element.pcb_trace_id, bounds)
      } else if (element.type === "pcb_via") {
        vias.push(element)
      }
    }
    const copper = { traces, traceBounds, vias }
    copperBySnapshot.set(snapshot, copper)
    return copper
  }

  return ({
    currentRoutes,
    candidateRoutes,
    changedTraceIds,
  }): ReturnType<Pipeline9HighDensityDrcCandidateGate> => {
    const snapshotStartedAt = performance.now()
    const currentSnapshot = getSnapshot(currentRoutes)
    const candidateSnapshot = getSnapshot(candidateRoutes)
    let candidateErrorPairsAreUnambiguous =
      unambiguousPairsBySnapshot.get(candidateSnapshot)
    if (candidateErrorPairsAreUnambiguous === undefined) {
      candidateErrorPairsAreUnambiguous =
        arePipeline9HighDensityDrcPairIdentifiersUnambiguous(
          candidateSnapshot.circuitJson,
        )
      unambiguousPairsBySnapshot.set(
        candidateSnapshot,
        candidateErrorPairsAreUnambiguous,
      )
    }
    const snapshotPreparationTimeMs = performance.now() - snapshotStartedAt
    const currentCopper = getCopper(currentSnapshot)
    const candidateCopper = getCopper(candidateSnapshot)
    const changedBounds: Pipeline9Bounds[] = []
    const changedViaSites = new Set<string>()
    for (const copper of [currentCopper, candidateCopper]) {
      for (const traceId of changedTraceIds) {
        const trace = copper.traces.get(traceId)
        if (!trace) {
          throw new Error(
            `Pipeline9 local DRC candidate has no changed trace "${traceId}"`,
          )
        }
        const bounds = copper.traceBounds.get(traceId)
        if (bounds) changedBounds.push(bounds)
        for (const point of trace.route) {
          if (point.route_type === "via") {
            changedViaSites.add(`${point.x},${point.y}`)
          }
        }
      }
    }
    // Conversion deduplicates colocated vias. Removing an earlier occurrence
    // can expose another owner's different diameter at that same physical site.
    // Include actual old AND new via copper there, regardless of its owner id.
    for (const copper of [currentCopper, candidateCopper]) {
      for (const via of copper.vias) {
        if (changedViaSites.has(`${via.x},${via.y}`)) {
          changedBounds.push(getViaBounds(via))
        }
      }
    }
    if (changedBounds.length === 0) {
      throw new Error("Pipeline9 local DRC candidate has no changed copper")
    }
    const clearance = Math.max(
      RELAXED_TRACE_CLEARANCE,
      MIN_VIA_TO_VIA_CLEARANCE,
    )
    const searchBounds = {
      minX: Math.min(...changedBounds.map((bounds) => bounds.minX)) - clearance,
      maxX: Math.max(...changedBounds.map((bounds) => bounds.maxX)) + clearance,
      minY: Math.min(...changedBounds.map((bounds) => bounds.minY)) - clearance,
      maxY: Math.max(...changedBounds.map((bounds) => bounds.maxY)) + clearance,
    }
    const selectedTraceIds = new Set(changedTraceIds)
    const selectedViaSites = new Set<string>()
    for (const copper of [currentCopper, candidateCopper]) {
      for (const [traceId, bounds] of copper.traceBounds) {
        if (doPipeline9BoundsOverlap(searchBounds, bounds)) {
          selectedTraceIds.add(traceId)
        }
      }
      for (const via of copper.vias) {
        if (doPipeline9BoundsOverlap(searchBounds, getViaBounds(via))) {
          selectedViaSites.add(`${via.x},${via.y}`)
        }
      }
    }
    // Keep complete neighbouring traces, never clipped segments: official
    // pad/via clearance checks aggregate the entire trace-obstacle pair.
    const contextKey = JSON.stringify([
      [...selectedTraceIds].sort(),
      currentCopper.vias
        .filter((via) => selectedViaSites.has(`${via.x},${via.y}`))
        .map((via) => via.pcb_via_id),
    ])
    const cachedBaseline = baselineBySnapshot.get(currentSnapshot)
    const scopedChecksStartedAt = performance.now()
    const currentErrors =
      cachedBaseline?.contextKey === contextKey
        ? cachedBaseline.errors
        : evaluateScopedCopper(
            currentSnapshot,
            selectedTraceIds,
            selectedViaSites,
          )
    baselineBySnapshot.set(currentSnapshot, {
      contextKey,
      errors: currentErrors,
    })
    const candidateErrors = evaluateScopedCopper(
      candidateSnapshot,
      selectedTraceIds,
      selectedViaSites,
    )
    return {
      currentErrors,
      candidateErrors,
      candidateErrorPairsAreUnambiguous,
      snapshotPreparationTimeMs,
      scopedCopperCheckTimeMs: performance.now() - scopedChecksStartedAt,
    }
  }
}
