import Flatbush from "flatbush"
import type { CapacityMeshNode, Obstacle, SimpleRouteJson } from "lib/types"
import { createSrjWithBoardValidObstacleLayers } from "lib/utils/create-srj-with-board-valid-obstacle-layers"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { getViaDimensions } from "lib/utils/getViaDimensions"
import { isOpaqueUnownedObstacle } from "lib/utils/isOpaqueUnownedObstacle"

type ConvexBlocker = {
  obstacle: Obstacle
  owners: Set<string>
  radius: number
  cosine: number
  sine: number
}

/** Proves an entire free rectangle has no landing for a physical through via. */
export function createIsThroughViaLandingBlocked(
  physicalSrj: SimpleRouteJson,
): (node: CapacityMeshNode) => boolean {
  const srj = createSrjWithBoardValidObstacleLayers(physicalSrj)
  const connMap = getConnectivityMapFromSimpleRouteJson(srj, {
    includeGeometricPointConnections: false,
  })
  const viaRadius = getViaDimensions(srj).padDiameter / 2
  const padClearance =
    srj.minViaEdgeToPadEdgeClearance ?? srj.minPadEdgeToPadEdgeClearance ?? 0.1
  const blockers: ConvexBlocker[] = []
  for (const obstacle of srj.obstacles) {
    // The proof requires the actual convex shape, never its enclosing AABB.
    if (
      obstacle.type !== "rect" ||
      obstacle.shape !== undefined ||
      obstacle.isNonPlatedHole ||
      obstacle.netIsAssignable ||
      obstacle.offBoardConnectsTo?.length ||
      ![
        obstacle.center.x,
        obstacle.center.y,
        obstacle.width,
        obstacle.height,
        obstacle.ccwRotationDegrees ?? 0,
      ].every(Number.isFinite) ||
      obstacle.width < 0 ||
      obstacle.height < 0
    )
      continue
    const owners = new Set<string>()
    let unknownOwner = false
    for (const id of obstacle.connectedTo) {
      const netId = connMap.getNetConnectedToId(id)
      if (netId === undefined) unknownOwner = true
      else owners.add(netId)
    }
    if (unknownOwner) continue
    // Recognized pad DRC accepts up to 5 um of clearance tolerance. Opaque
    // barriers require copper non-overlap, without the pad clearance rule.
    const radius =
      viaRadius + (isOpaqueUnownedObstacle(obstacle) ? 0 : padClearance) - 0.005
    if (!Number.isFinite(radius) || radius <= 0) continue
    const radians = ((obstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180
    blockers.push({
      obstacle,
      owners,
      radius,
      cosine: Math.cos(radians),
      sine: Math.sin(radians),
    })
  }
  const index = blockers.length > 0 ? new Flatbush(blockers.length) : undefined
  for (const { obstacle, radius, cosine, sine } of blockers) {
    const halfX =
      (Math.abs(cosine) * obstacle.width + Math.abs(sine) * obstacle.height) / 2
    const halfY =
      (Math.abs(sine) * obstacle.width + Math.abs(cosine) * obstacle.height) / 2
    index!.add(
      obstacle.center.x - halfX - radius,
      obstacle.center.y - halfY - radius,
      obstacle.center.x + halfX + radius,
      obstacle.center.y + halfY + radius,
    )
  }
  index?.finish()
  return (node: CapacityMeshNode): boolean => {
    if (!index) return false
    let commonOwners: Set<string> | undefined
    const candidates = index.search(
      node.center.x,
      node.center.y,
      node.center.x,
      node.center.y,
    )
    for (const id of candidates) {
      const { obstacle, radius, cosine, sine, owners } = blockers[id]!
      const roundingSlack =
        1e-9 +
        Number.EPSILON *
          64 *
          (Math.abs(node.center.x) +
            Math.abs(node.center.y) +
            Math.abs(obstacle.center.x) +
            Math.abs(obstacle.center.y) +
            node.width +
            node.height +
            obstacle.width +
            obstacle.height)
      let coversRectangle = true
      for (const signX of [-1, 1]) {
        for (const signY of [-1, 1]) {
          const dx = node.center.x + signX * node.width / 2 - obstacle.center.x
          const dy = node.center.y + signY * node.height / 2 - obstacle.center.y
          const x = dx * cosine + dy * sine
          const y = -dx * sine + dy * cosine
          const distance = Math.hypot(
            Math.max(Math.abs(x) - obstacle.width / 2, 0),
            Math.max(Math.abs(y) - obstacle.height / 2, 0),
          )
          if (!(distance + roundingSlack < radius)) coversRectangle = false
        }
      }
      // Distance to a convex rectangle is convex: all four strict corner
      // bounds prove every center in the entire original rectangle is blocked.
      if (!coversRectangle) continue
      if (owners.size === 0) return true
      commonOwners =
        commonOwners === undefined
          ? new Set(owners)
          : new Set([...commonOwners].filter((owner) => owners.has(owner)))
      // A route can own one electrical net; it cannot be exempt from all
      // individually covering blockers when their owner classes are disjoint.
      if (commonOwners.size === 0) return true
    }
    return false
  }
}
