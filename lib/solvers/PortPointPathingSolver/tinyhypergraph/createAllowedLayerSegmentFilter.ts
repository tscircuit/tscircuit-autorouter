import type { AllowedLayersByConnection } from "lib/utils/getAllowedLayersByConnection"
import type {
  TinyHyperGraphProblem,
  TinyHyperGraphTopology,
} from "tiny-hypergraph/lib/index"

export function createAllowedLayerSegmentFilter(
  graph: { topology: TinyHyperGraphTopology; problem: TinyHyperGraphProblem },
  allowedLayersByConnection: AllowedLayersByConnection,
): TinyHyperGraphProblem["routeSegmentFilter"] {
  const { topology, problem } = graph
  const restrictions = Array.from({ length: problem.routeCount }, (_, routeId) => {
    const connectionId: unknown = problem.routeMetadata?.[routeId]?.connectionId
    return typeof connectionId === "string"
      ? allowedLayersByConnection.get(connectionId)
      : undefined
  })
  if (!restrictions.some((layers) => layers !== undefined)) return
  return (routeId, _regionId, fromPortId, toPortId) => {
    const layers = restrictions[routeId]
    // Via barrels may cross excluded layers; their entry and exit must be allowed.
    return (
      !layers ||
      (layers.has(topology.portZ[fromPortId]!) &&
        layers.has(topology.portZ[toPortId]!))
    )
  }
}
