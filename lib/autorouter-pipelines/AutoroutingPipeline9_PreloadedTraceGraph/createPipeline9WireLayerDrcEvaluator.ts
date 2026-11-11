import type { DrcEvaluator } from "high-density-repair03/lib"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectionAllowedZ } from "lib/utils/getConnectionAllowedZ"

/** The existing reference guard must never exchange a wire policy for clearance. */
export function createPipeline9WireLayerDrcEvaluator(
  srj: SimpleRouteJson,
): DrcEvaluator | undefined {
  const allowedZByConnectionName = getConnectionAllowedZ(srj)
  if (allowedZByConnectionName.size === 0) return undefined
  const evaluate: DrcEvaluator = ({ routes, hdRoutes }) => {
    const evaluatedRoutes: HighDensityRoute[] | undefined = routes ?? hdRoutes
    if (!evaluatedRoutes)
      throw new Error("Wire-layer evaluation requires HD routes")
    const errors: Record<string, unknown>[] = []
    for (const route of evaluatedRoutes) {
      if ("isThroughObstacle" in route && route.isThroughObstacle === true)
        continue
      const allowedZ =
        allowedZByConnectionName.get(route.connectionName) ??
        (route.rootConnectionName === undefined
          ? undefined
          : allowedZByConnectionName.get(route.rootConnectionName)) ??
        route.allowedZ
      if (allowedZ === undefined) continue
      for (let index = 1; index < route.route.length; index++) {
        const a = route.route[index - 1]!,
          b = route.route[index]!
        if (
          a.toNextSegmentType === "through_obstacle" ||
          (a.x === b.x && a.y === b.y) ||
          (allowedZ.includes(a.z) && allowedZ.includes(b.z))
        )
          continue
        errors.push({
          type: "pcb_trace_error",
          error_type: "pcb_trace_error",
          drc_source: "wire_layer",
          pcb_trace_id: `${route.connectionName}_0`,
          pcb_trace_error_id: `wire_layer_${route.connectionName}_${index}`,
          message: `Connection "${route.connectionName}" uses a prohibited wire layer`,
          center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        })
      }
    }
    return { errors, errorsWithCenters: errors }
  }
  evaluate.inputMode = "routes-only"
  return evaluate
}
