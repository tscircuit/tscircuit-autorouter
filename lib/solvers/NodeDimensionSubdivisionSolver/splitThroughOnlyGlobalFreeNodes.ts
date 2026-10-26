import type { CapacityMeshNode, SimpleRouteJson } from "lib/types"
import { createIsThroughViaLandingBlocked } from "./createIsThroughViaLandingBlocked"

type ThroughOnlyPolicy = {
  layerCount: number
  allowBlindAndBuriedVias?: boolean
  allowViaInPad?: boolean
  physicalSrj?: SimpleRouteJson
}

const GEOMETRY_KEYS = new Set([
  "capacityMeshNodeId",
  "center",
  "width",
  "height",
  "layer",
  "availableZ",
])
const EMPTY_ROLE_KEYS = new Set([
  "_containsObstacle",
  "_containsTarget",
  "_completelyInsideObstacle",
  "_isComponentTopologyNode",
  "_isNarrowQfpPadGap",
])

/** A partial free stack cannot host a through via across its missing layers. */
export function splitThroughOnlyGlobalFreeNodes(
  nodes: CapacityMeshNode[],
  policy: ThroughOnlyPolicy,
): CapacityMeshNode[] {
  // Via-in-pad permits repair inside connected pads; it does not authorize
  // transitions through foreign copper or keepouts below unowned free space.
  if (policy.allowBlindAndBuriedVias) return nodes
  const isLandingBlocked = policy.physicalSrj
    ? createIsThroughViaLandingBlocked(policy.physicalSrj)
    : undefined
  const usedIds = new Set(nodes.map((node) => node.capacityMeshNodeId))
  const output: CapacityMeshNode[] = []
  let splitAny = false
  for (const node of nodes) {
    const validMultilayer =
      node.availableZ.length > 1 &&
      node.availableZ.every(
        (z) => Number.isInteger(z) && z >= 0 && z < policy.layerCount,
      ) &&
      new Set(node.availableZ).size === node.availableZ.length &&
      [node.center.x, node.center.y, node.width, node.height].every(
        Number.isFinite,
      ) &&
      node.width > 0 &&
      node.height > 0
    const plainFree = Object.entries(node).every(
      ([key, value]) =>
        GEOMETRY_KEYS.has(key) ||
        value === undefined ||
        (EMPTY_ROLE_KEYS.has(key) && value === false),
    )
    const partial = node.availableZ.length < policy.layerCount
    if (
      !validMultilayer ||
      !plainFree ||
      (!partial && !isLandingBlocked?.(node))
    ) {
      output.push(node)
      continue
    }
    splitAny = true
    for (const z of node.availableZ) {
      let id = `${node.capacityMeshNodeId}__single_z${z}`
      while (usedIds.has(id)) id += "_next"
      usedIds.add(id)
      output.push({
        ...node,
        capacityMeshNodeId: id,
        availableZ: [z],
        layer: `z${z}`,
      })
    }
  }
  return splitAny ? output : nodes
}
