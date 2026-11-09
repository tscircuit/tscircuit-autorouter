import {
  createFixedObstacleViolationEvaluator,
  type FixedObstacleViolation,
} from "@tscircuit/repair04"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { getViaToPadClearance } from "lib/utils/getViaToPadClearance"
import { RELAXED_DRC_OPTIONS } from "lib/utils/drcPresets"
import { convertPreloadedTraceToHdRoutes } from "./convertPreloadedTraceToHdRoutes"

type DrcError = Record<string, unknown>
type ViaLocationKey = string
type ViaGeometryKey = string
type PcbTraceId = string
type CachedTraceCheck = {
  geometry: string
  violations: FixedObstacleViolation[]
}

/** Retains earlier copper that has no pad identity in Circuit JSON. */
export const createPipeline9FixedCopperDrcEvaluator = ({
  inputSrj,
  srjWithPointPairs,
  representedPadObstacleIndexes,
  traceClearance,
  viaClearance,
}: {
  inputSrj: SimpleRouteJson
  srjWithPointPairs: SimpleRouteJson
  representedPadObstacleIndexes: ReadonlySet<number>
  traceClearance?: number
  viaClearance?: number
}): ((traces: SimplifiedPcbTrace[]) => DrcError[]) => {
  const fixedObstacleIndexes = new Set<number>()
  const wireObstacleIndexes = new Set<number>()
  for (const [obstacleIndex, obstacle] of inputSrj.obstacles.entries()) {
    if (
      representedPadObstacleIndexes.has(obstacleIndex) ||
      obstacle.connectedTo.length === 0 ||
      obstacle.isCopperPour ||
      obstacle.isNonPlatedHole
    ) {
      continue
    }
    fixedObstacleIndexes.add(obstacleIndex)
    // Identified vias retain their existing via-specific evaluation.
    // Anonymous copper includes the earlier data wires from Core.
    if (!obstacle.circuitJsonMetadata?.pcb_via_id) {
      wireObstacleIndexes.add(obstacleIndex)
    }
  }
  if (fixedObstacleIndexes.size === 0) {
    return (): DrcError[] => []
  }
  const fixedCopperSrj = {
    ...inputSrj,
    traces: undefined,
    connections: [...srjWithPointPairs.connections, ...inputSrj.connections],
  }
  const connMap = getConnectivityMapFromSimpleRouteJson(inputSrj)
  const clearance = Math.max(
    viaClearance ??
      getViaToPadClearance(inputSrj) ??
      RELAXED_DRC_OPTIONS.traceClearance,
    inputSrj.defaultObstacleMargin ?? 0,
    inputSrj.minViaEdgeToPadEdgeClearance ?? 0,
  )
  let checksByTraceId = new Map<PcbTraceId, CachedTraceCheck>()
  const errorsByViaGeometry = new Map<ViaGeometryKey, DrcError[]>()
  const checkWireSegments = wireObstacleIndexes.size > 0
  let evaluateObstacles:
    | ReturnType<typeof createFixedObstacleViolationEvaluator>
    | undefined
  return (traces): DrcError[] => {
    let viaGeometryKey: ViaGeometryKey | undefined
    if (!checkWireSegments) {
      viaGeometryKey = JSON.stringify(
        traces.map((trace) => [
          trace.pcb_trace_id,
          trace.connection_name,
          trace.route.filter((point) => point.route_type === "via"),
        ]),
      )
      const cachedErrors = errorsByViaGeometry.get(viaGeometryKey)
      if (cachedErrors !== undefined) return cachedErrors
    }
    const viaIds = new Map<ViaLocationKey, string>()
    const routes = traces.flatMap((trace, traceIndex) =>
      convertPreloadedTraceToHdRoutes(
        trace,
        traceIndex,
        inputSrj.layerCount,
        inputSrj.minViaPadDiameter ?? inputSrj.minViaDiameter ?? 0.3,
        connMap,
      )
        .filter((route) => checkWireSegments || route.vias.length > 0)
        .map((route) => {
          const point = trace.route[route.preloadedRoutePositionStart!]!
          let pcbViaId: string | undefined
          if (point.route_type === "via") {
            const key: ViaLocationKey = `${point.x},${point.y},${point.from_layer},${point.to_layer}`
            if (!viaIds.has(key)) viaIds.set(key, `via_${viaIds.size}`)
            pcbViaId = viaIds.get(key)!
          }
          return {
            ...route,
            // The obstacle checker resolves SRJ aliases, not connMap's synthetic net IDs.
            rootConnectionName: trace.connection_name,
            pcbViaId,
          }
        }),
    )
    evaluateObstacles ??= createFixedObstacleViolationEvaluator({
      srj: fixedCopperSrj,
      routes,
      traceClearance: traceClearance ?? RELAXED_DRC_OPTIONS.traceClearance,
      viaClearance: clearance,
    })
    const nextChecksByTraceId = new Map<PcbTraceId, CachedTraceCheck>()
    const violations: FixedObstacleViolation[] = []
    for (const [traceIndex, trace] of traces.entries()) {
      const traceRoutes = routes.filter(
        (route) => route.preloadedTraceIndex === traceIndex,
      )
      let copperGeometry = trace.route
      if (!checkWireSegments) {
        copperGeometry = trace.route.filter(
          (point) => point.route_type === "via",
        )
      }
      const geometry = JSON.stringify([trace.connection_name, copperGeometry])
      let check = checksByTraceId.get(trace.pcb_trace_id)
      if (check?.geometry !== geometry) {
        check = { geometry, violations: evaluateObstacles(traceRoutes) }
      }
      nextChecksByTraceId.set(trace.pcb_trace_id, check)
      for (const violation of check.violations) {
        violations.push({
          ...violation,
          routeIndex: routes.indexOf(traceRoutes[violation.routeIndex]!),
        })
      }
    }
    checksByTraceId = nextChecksByTraceId
    // Preserve obstacle/route order when combining independently cached checks.
    violations.sort(
      (a, b) =>
        a.obstacleIndex - b.obstacleIndex || a.routeIndex - b.routeIndex,
    )
    const errors = violations
      .filter(({ obstacleIndex, kind }) => {
        if (kind === "wire") return wireObstacleIndexes.has(obstacleIndex)
        return fixedObstacleIndexes.has(obstacleIndex)
      })
      .map((violation): DrcError => {
        const trace = traces[routes[violation.routeIndex]!.preloadedTraceIndex]!
        if (violation.kind === "wire") {
          return {
            type: "pcb_trace_error",
            error_type: "pcb_trace_error",
            drc_source: "fixed_copper",
            pcb_trace_error_id: `fixed_copper_${trace.pcb_trace_id}_${violation.obstacleIndex}`,
            pcb_trace_id: trace.pcb_trace_id,
            center: violation.center,
            message: "Trace is too close to fixed copper on its layer",
          }
        }
        return {
          type: "pcb_via_trace_clearance_error",
          error_type: "pcb_via_trace_clearance_error",
          drc_source: "fixed_copper",
          pcb_via_trace_clearance_error_id: `fixed_copper_${trace.pcb_trace_id}_${violation.obstacleIndex}_${routes[violation.routeIndex]!.pcbViaId}`,
          pcb_via_id: routes[violation.routeIndex]!.pcbViaId,
          pcb_trace_id: trace.pcb_trace_id,
          center: violation.center,
          actual_clearance: clearance - violation.severity,
          minimum_clearance: clearance,
          message: "Via is too close to fixed copper on a drilled layer",
        }
      })
    if (viaGeometryKey !== undefined) {
      if (errorsByViaGeometry.size >= 64) {
        errorsByViaGeometry.delete(errorsByViaGeometry.keys().next().value!)
      }
      errorsByViaGeometry.set(viaGeometryKey, errors)
    }
    return errors
  }
}
