import type { AllowedLayersByConnection } from "lib/utils/getAllowedLayersByConnection"
import type { TinyHyperGraphProblem } from "tiny-hypergraph/lib/index"

export function getRouteAllowedZ(
  problem: TinyHyperGraphProblem,
  allowedLayersByConnection: AllowedLayersByConnection,
): TinyHyperGraphProblem["routeAllowedZ"] {
  const restrictions = Array.from({ length: problem.routeCount }, (_, routeId) => {
    const connectionId: unknown = problem.routeMetadata?.[routeId]?.connectionId
    if (typeof connectionId !== "string") return undefined
    const layers = allowedLayersByConnection.get(connectionId)
    return layers === undefined ? undefined : [...layers]
  })
  return restrictions.some((layers) => layers !== undefined) ? restrictions : undefined
}
