import type {
  ConnectionPoint,
  PointKey,
  SimpleRouteConnection,
} from "lib/types"
import { getPointKey } from "lib/utils/getPointKey"
import { DisjointSet } from "lib/solvers/NetToPointPairsSolver/buildMinimumSpanningTree"
import type { MergedConnectionTopologyEdge } from "lib/solvers/NetToPointPairsSolver/NetToPointPairsSolver"

type TreeLink = { point: PointKey; edge: MergedConnectionTopologyEdge }
type TreeNode = { depth: number; parent?: TreeLink }

/** Shared tree edges carry the largest width requested on their source paths. */
export function getMstEdgeTraceWidths(
  mergedPoints: readonly ConnectionPoint[],
  edges: readonly MergedConnectionTopologyEdge[],
  sourceConnections: readonly SimpleRouteConnection[],
  defaultTraceWidth?: number,
): Map<MergedConnectionTopologyEdge, number> {
  const widths = new Map<MergedConnectionTopologyEdge, number>()
  const firstEdge = edges[0]
  if (!firstEdge) return widths

  // A direct pair can connect two distinct pads at the same XY. Kruskal's
  // tree for larger nets treats terminals at the same XY as one vertex.
  const getTreePointKey =
    mergedPoints.length === 2 ? getPointKey : DisjointSet.pointToKey
  const neighborsByPoint = new Map<PointKey, TreeLink[]>()
  for (const edge of edges) {
    const from = getTreePointKey(edge.from)
    const to = getTreePointKey(edge.to)
    for (const [point, neighbor] of [
      [from, to],
      [to, from],
    ] as const) {
      const neighbors = neighborsByPoint.get(point) ?? []
      neighbors.push({ point: neighbor, edge })
      neighborsByPoint.set(point, neighbors)
    }
  }

  const root = getTreePointKey(firstEdge.from)
  const treeNodes = new Map<PointKey, TreeNode>([[root, { depth: 0 }]])
  const pendingPoints: PointKey[] = [root]
  for (const point of pendingPoints) {
    const node = treeNodes.get(point)!
    for (const neighbor of neighborsByPoint.get(point)!) {
      if (treeNodes.has(neighbor.point)) continue
      treeNodes.set(neighbor.point, {
        depth: node.depth + 1,
        parent: { point, edge: neighbor.edge },
      })
      pendingPoints.push(neighbor.point)
    }
  }

  const mergedPointByKey = new Map(
    mergedPoints.map((point) => [getPointKey(point), point]),
  )
  for (const source of sourceConnections) {
    const width = source.nominalTraceWidth ?? source.width ?? defaultTraceWidth
    if (width === undefined || source.pointsToConnect.length < 2) continue

    const [start, ...rest] = source.pointsToConnect.map((point): TreeNode => {
      const mergedPoint = mergedPointByKey.get(getPointKey(point))
      const node = mergedPoint && treeNodes.get(getTreePointKey(mergedPoint))
      if (!node) {
        throw new Error(`MST is missing a terminal of "${source.name}"`)
      }
      return node
    })
    for (const terminal of rest) {
      let left = start!
      let right = terminal

      // Ascend to the common ancestor to visit only this source's path.
      while (left !== right) {
        const ascendLeft: boolean = left.depth >= right.depth
        const parent: TreeLink = (ascendLeft ? left : right).parent!
        const previousWidth = widths.get(parent.edge)
        if (previousWidth === undefined || width > previousWidth) {
          widths.set(parent.edge, width)
        }
        if (ascendLeft) left = treeNodes.get(parent.point)!
        else right = treeNodes.get(parent.point)!
      }
    }
  }

  return widths
}
