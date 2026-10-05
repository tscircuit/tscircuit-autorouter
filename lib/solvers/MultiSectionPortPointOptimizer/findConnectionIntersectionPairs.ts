import type { CapacityMeshNode, CapacityMeshNodeId } from "../../types"
import type { PortPointSection } from "./createPortPointSection"
import type { PortPoint } from "../../types/high-density-types"

/**
 * Maps a boundary point to a 1D perimeter coordinate (clockwise from top-left).
 */
function perimeterT(
  p: { x: number; y: number },
  xmin: number,
  xmax: number,
  ymin: number,
  ymax: number,
): number {
  const W = xmax - xmin
  const H = ymax - ymin
  const eps = 1e-6

  if (Math.abs(p.y - ymax) < eps) return p.x - xmin // Top edge
  if (Math.abs(p.x - xmax) < eps) return W + (ymax - p.y) // Right edge
  if (Math.abs(p.y - ymin) < eps) return W + H + (xmax - p.x) // Bottom edge
  if (Math.abs(p.x - xmin) < eps) return 2 * W + H + (p.y - ymin) // Left edge

  // Point not on boundary - find closest edge
  const distTop = Math.abs(p.y - ymax)
  const distRight = Math.abs(p.x - xmax)
  const distBottom = Math.abs(p.y - ymin)
  const distLeft = Math.abs(p.x - xmin)
  const minDist = Math.min(distTop, distRight, distBottom, distLeft)

  if (minDist === distTop) return Math.max(0, Math.min(W, p.x - xmin))
  if (minDist === distRight) return W + Math.max(0, Math.min(H, ymax - p.y))
  if (minDist === distBottom)
    return W + H + Math.max(0, Math.min(W, xmax - p.x))
  return 2 * W + H + Math.max(0, Math.min(H, p.y - ymin))
}

export interface FindConnectionIntersectionPairsParams {
  section: PortPointSection
  nodePfMap: Map<CapacityMeshNodeId, number>
  capacityMeshNodeMap: Map<CapacityMeshNodeId, CapacityMeshNode>
  nodeAssignedPortPoints: Map<CapacityMeshNodeId, PortPoint[]>
  acceptablePf: number
}

/**
 * Find connections that have same-layer crossings within a section.
 * Uses circle/perimeter mapping approach (like getIntraNodeCrossingsUsingCircle).
 * Only analyzes nodes with pf > acceptablePf.
 * Returns a list of crossing pairs (each pair contains two connection names that cross).
 */
export function findConnectionIntersectionPairs(
  params: FindConnectionIntersectionPairsParams,
): Array<[string, string]> {
  const {
    section,
    nodePfMap,
    capacityMeshNodeMap,
    nodeAssignedPortPoints,
    acceptablePf,
  } = params
  const intersectionPairs: Array<[string, string]> = []

  // Only analyze nodes with high probability of failure
  for (const nodeId of section.nodeIds) {
    const pf = nodePfMap.get(nodeId) ?? 0
    if (pf <= acceptablePf) continue

    const capacityNode = capacityMeshNodeMap.get(nodeId)
    if (!capacityNode) continue

    const portPoints = nodeAssignedPortPoints.get(nodeId) ?? []
    if (portPoints.length < 2) continue

    // Compute node bounds
    const xmin = capacityNode.center.x - capacityNode.width / 2
    const xmax = capacityNode.center.x + capacityNode.width / 2
    const ymin = capacityNode.center.y - capacityNode.height / 2
    const ymax = capacityNode.center.y + capacityNode.height / 2

    // Group port points by connection
    const connectionPointsMap = new Map<
      string,
      Array<{ x: number; y: number; z: number }>
    >()

    for (const pp of portPoints) {
      const points = connectionPointsMap.get(pp.connectionName) ?? []
      if (!points.some((p) => p.x === pp.x && p.y === pp.y && p.z === pp.z)) {
        points.push({ x: pp.x, y: pp.y, z: pp.z })
      }
      connectionPointsMap.set(pp.connectionName, points)
    }

    // Build same-layer chords by layer, storing connection name with each chord
    const sameLayerChordsByZ = new Map<
      number,
      Array<{ connectionName: string; t1: number; t2: number }>
    >()

    for (const [connectionName, points] of connectionPointsMap) {
      if (points.length < 2) continue

      const p1 = points[0]
      const p2 = points[1]

      // Only care about same-layer pairs
      if (p1.z !== p2.z) continue

      const t1 = perimeterT(p1, xmin, xmax, ymin, ymax)
      const t2 = perimeterT(p2, xmin, xmax, ymin, ymax)
      const z = p1.z

      const chords = sameLayerChordsByZ.get(z) ?? []
      chords.push({ connectionName, t1, t2 })
      sameLayerChordsByZ.set(z, chords)
    }

    // Find crossing pairs using chord interleaving criterion
    const eps = 1e-6
    for (const [, chords] of sameLayerChordsByZ) {
      // Normalize chords so t1 < t2
      const normalized = chords.map((c) => ({
        connectionName: c.connectionName,
        a: Math.min(c.t1, c.t2),
        b: Math.max(c.t1, c.t2),
      }))

      for (let i = 0; i < normalized.length; i++) {
        const { connectionName: name1, a, b } = normalized[i]
        for (let j = i + 1; j < normalized.length; j++) {
          const { connectionName: name2, a: c, b: d } = normalized[j]

          // Skip if chords share a coincident endpoint
          if (
            Math.abs(a - c) < eps ||
            Math.abs(a - d) < eps ||
            Math.abs(b - c) < eps ||
            Math.abs(b - d) < eps
          ) {
            continue
          }

          // Two chords cross iff: a < c < b < d OR c < a < d < b
          if ((a < c && c < b && b < d) || (c < a && a < d && d < b)) {
            intersectionPairs.push([name1, name2])
          }
        }
      }
    }
  }

  return intersectionPairs
}
