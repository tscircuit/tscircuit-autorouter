import type { NodeWithPortPoints } from "lib/types/high-density-types"
import type { SimpleRouteConnection, SimpleRouteJson } from "lib/types"
import { getAllowedZByConnectionName } from "./getAllowedZByConnectionName"

/** Intersect a node's routable z-layers with any `bus.allowedLayers` rules on its port points. */
export function narrowNodeAvailableZForBuses(
  node: NodeWithPortPoints,
  context: {
    srj?: Pick<SimpleRouteJson, "buses" | "layerCount">
    connections?: readonly SimpleRouteConnection[]
    fallbackLayerCount: number
  },
): NodeWithPortPoints {
  if (!context.srj?.buses?.some((bus) => bus.allowedLayers?.length)) {
    return node
  }
  const allowedZByConnectionName = getAllowedZByConnectionName(
    context.srj,
    context.connections ?? [],
  )
  if (allowedZByConnectionName.size === 0) return node

  const restrictedSets = node.portPoints.flatMap((pp) => {
    const allowedSet =
      allowedZByConnectionName.get(pp.connectionName) ??
      (pp.rootConnectionName
        ? allowedZByConnectionName.get(pp.rootConnectionName)
        : undefined)
    return allowedSet ? [allowedSet] : []
  })
  if (restrictedSets.length === 0) return node

  const baseAvailableZ =
    node.availableZ ??
    Array.from({ length: context.fallbackLayerCount }, (_, z) => z)
  const narrowedAvailableZ = baseAvailableZ.filter((z) =>
    restrictedSets.every((set) => set.has(z)),
  )
  const coversAllNodePorts = node.portPoints.every((pp) =>
    narrowedAvailableZ.includes(pp.z),
  )
  if (!coversAllNodePorts || narrowedAvailableZ.length < 2) return node
  return { ...node, availableZ: narrowedAvailableZ }
}
