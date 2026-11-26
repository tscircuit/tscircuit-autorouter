import type {
  ConnectionPoint,
  PointKey,
  SimpleRouteConnection,
} from "lib/types"
import { getPointKey } from "lib/utils/getPointKey"
import type { Edge } from "./buildMinimumSpanningTree"

type ConnectionEdge = Edge<ConnectionPoint>

type TreeLink = { point: PointKey; edge: ConnectionEdge }
type TreeNode = { depth: number; parent?: TreeLink }

/** Shared tree edges carry the largest width requested on their source paths. */
export function getMstEdgeTraceWidths(
  mergedPoints: readonly ConnectionPoint[],
  edges: readonly ConnectionEdge[],
  sourceConnections: readonly SimpleRouteConnection[],
  defaultTraceWidth?: number,
): Map<ConnectionEdge, number> {
  const widths = new Map<ConnectionEdge, number>()

  // The MST treats terminals at the same XY position as one vertex.
  const neighborsByPoint = new Map<PointKey, TreeLink[]>()
  for (const edge of edges) {
    const from = `${edge.from.x},${edge.from.y}`
    const to = `${edge.to.x},${edge.to.y}`
    for (const [point, neighbor] of [
      [from, to],
      [to, from],
    ] as const) {
      const neighbors = neighborsByPoint.get(point) ?? []
      neighbors.push({ point: neighbor, edge })
      neighborsByPoint.set(point, neighbors)
    }
  }

  const [root] = neighborsByPoint.keys()
  if (root === undefined) return widths
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

  const nodeByPointKey = new Map(
    mergedPoints.map((point) => [
      getPointKey(point),
      treeNodes.get(`${point.x},${point.y}`),
    ]),
  )
  for (const source of sourceConnections) {
    const width = source.nominalTraceWidth ?? source.width ?? defaultTraceWidth
    if (width === undefined || source.pointsToConnect.length < 2) continue

    const [start, ...rest] = source.pointsToConnect.map((point): TreeNode => {
      const node = nodeByPointKey.get(getPointKey(point))
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
