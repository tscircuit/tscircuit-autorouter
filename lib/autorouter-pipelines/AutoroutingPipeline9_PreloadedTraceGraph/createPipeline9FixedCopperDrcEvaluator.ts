import { getFixedObstacleViolations } from "@tscircuit/repair04"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { getViaToPadClearance } from "lib/utils/getViaToPadClearance"
import { RELAXED_DRC_OPTIONS } from "lib/utils/drcPresets"
import { convertPreloadedTraceToHdRoutes } from "./convertPreloadedTraceToHdRoutes"

type DrcError = Record<string, unknown>
type ViaLocationKey = string
type ViaGeometryKey = string
type ViaCheckKey = string & { readonly __brand: "ViaCheckKey" }

const VIA_CHECK_CACHE_CAPACITY = 512

/** Retains earlier copper that has no pad identity in Circuit JSON. */
export const createPipeline9FixedCopperDrcEvaluator = ({
  inputSrj,
  srjWithPointPairs,
  representedPadObstacleIndexes,
  viaClearance,
}: {
  inputSrj: SimpleRouteJson
  srjWithPointPairs: SimpleRouteJson
  representedPadObstacleIndexes: ReadonlySet<number>
  viaClearance?: number
}): ((traces: SimplifiedPcbTrace[]) => DrcError[]) => {
  if (
    !inputSrj.obstacles.some(
      (obstacle, obstacleIndex) =>
        !representedPadObstacleIndexes.has(obstacleIndex) &&
        obstacle.connectedTo.length > 0 &&
        !obstacle.isCopperPour &&
        !obstacle.isNonPlatedHole,
    )
  ) {
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
  const errorsByViaGeometry = new Map<ViaGeometryKey, DrcError[]>()
  const violationsByVia = new Map<
    ViaCheckKey,
    ReturnType<typeof getFixedObstacleViolations>
  >()
  return (traces): DrcError[] => {
    // Wire-only candidates leave this via-only check unchanged. Include trace
    // identity, ownership, diameter and layer span so moved vias are rechecked.
    const key = JSON.stringify(
      traces.map((trace) => [
        trace.pcb_trace_id,
        trace.connection_name,
        trace.route.filter((point) => point.route_type === "via"),
      ]),
    ) as ViaGeometryKey
    const cachedErrors = errorsByViaGeometry.get(key)
    if (cachedErrors !== undefined) return cachedErrors
    const viaIds = new Map<ViaLocationKey, string>()
    const routes = traces.flatMap((trace, traceIndex) =>
      convertPreloadedTraceToHdRoutes(
        trace,
        traceIndex,
        inputSrj.layerCount,
        inputSrj.minViaPadDiameter ?? inputSrj.minViaDiameter ?? 0.3,
        connMap,
      )
        .filter((route) => route.vias.length > 0)
        .map((route) => {
          const point = trace.route[route.preloadedRoutePositionStart!]!
          if (point.route_type !== "via") {
            throw new Error("Fixed copper via evaluation requires a via point")
          }
          const key: ViaLocationKey = `${point.x},${point.y},${point.from_layer},${point.to_layer}`
          if (!viaIds.has(key)) viaIds.set(key, `via_${viaIds.size}`)
          return {
            ...route,
            rootConnectionName: trace.connection_name,
            pcbViaId: viaIds.get(key)!,
          }
        }),
    )
    const viaKeys = routes.map(
      (route): ViaCheckKey =>
        JSON.stringify([
          route.rootConnectionName,
          route.viaDiameter,
          route.route,
        ]) as ViaCheckKey,
    )
    const violationsByRoute = viaKeys.map((viaKey) =>
      violationsByVia.get(viaKey),
    )
    const uncachedViaIndexes: number[] = []
    const uncheckedRoutes = routes.flatMap((route, routeIndex) => {
      if (violationsByRoute[routeIndex] !== undefined) return []
      uncachedViaIndexes.push(routeIndex)
      // Section names change with wire points; electrical ownership does not.
      return [{ ...route, connectionName: route.rootConnectionName }]
    })
    if (uncachedViaIndexes.length > 0) {
      const uncheckedViolations: Array<
        ReturnType<typeof getFixedObstacleViolations>
      > = uncachedViaIndexes.map(() => [])
      // Prepare static geometry once for all misses in this candidate.
      for (const violation of getFixedObstacleViolations({
        srj: fixedCopperSrj,
        routes: uncheckedRoutes,
        viaClearance: clearance,
      })) {
        uncheckedViolations[violation.routeIndex]!.push(violation)
      }
      for (let index = 0; index < uncachedViaIndexes.length; index++) {
        const routeIndex = uncachedViaIndexes[index]!
        const violations = uncheckedViolations[index]!
        violationsByRoute[routeIndex] = violations
        if (violationsByVia.size >= VIA_CHECK_CACHE_CAPACITY) {
          violationsByVia.delete(violationsByVia.keys().next().value!)
        }
        violationsByVia.set(viaKeys[routeIndex]!, violations)
      }
    }
    const errors = violationsByRoute
      .flatMap((violations, routeIndex) =>
        violations!.map((violation) => ({ ...violation, routeIndex })),
      )
      // Preserve the checker's obstacle-first order and current candidate IDs.
      .sort(
        (left, right) =>
          left.obstacleIndex - right.obstacleIndex ||
          left.routeIndex - right.routeIndex,
      )
      .filter(({ obstacleIndex }) => {
        const obstacle = inputSrj.obstacles[obstacleIndex]!
        return (
          !representedPadObstacleIndexes.has(obstacleIndex) &&
          obstacle.connectedTo.length > 0 &&
          !obstacle.isCopperPour &&
          !obstacle.isNonPlatedHole
        )
      })
      .map((violation): DrcError => {
        const trace = traces[routes[violation.routeIndex]!.preloadedTraceIndex]!
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
    if (errorsByViaGeometry.size >= 64) {
      errorsByViaGeometry.delete(errorsByViaGeometry.keys().next().value!)
    }
    errorsByViaGeometry.set(key, errors)
    return errors
  }
}
