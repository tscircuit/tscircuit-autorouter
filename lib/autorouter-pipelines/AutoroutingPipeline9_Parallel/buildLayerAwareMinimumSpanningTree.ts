import type { ConnectionPoint } from "../../types/srj-types"
import { getConnectionPointLayers } from "../../utils/connection-point-utils"

type Edge = { from: ConnectionPoint; to: ConnectionPoint; weight: number }

const pointKey = (point: ConnectionPoint): string =>
  `${point.x},${point.y},${[...getConnectionPointLayers(point)].sort().join("|")}`

/** Co-located terminals on distinct copper layers still need a physical edge. */
export function buildLayerAwareMinimumSpanningTree(
  inputPoints: ConnectionPoint[], extraEdges: Edge[],
): Edge[] {
  const points: ConnectionPoint[] = []
  const indexByKey = new Map<string, number>()
  for (const point of inputPoints) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      throw new Error("Layer-aware point-pair tree requires finite coordinates")
    }
    const key = pointKey(point)
    if (!indexByKey.has(key)) {
      indexByKey.set(key, points.length)
      points.push(point)
    }
  }
  const parent = Int32Array.from(points, (_, index) => index)
  const edges: Edge[] = []
  for (let first = 0; first < points.length; first++) {
    for (let second = first + 1; second < points.length; second++) {
      const from = points[first]!, to = points[second]!
      edges.push({ from, to, weight: Math.sqrt((from.x - to.x) ** 2 + (from.y - to.y) ** 2) })
    }
  }
  edges.push(...extraEdges)
  edges.sort((first, second) => first.weight - second.weight)
  const output: Edge[] = []
  for (const edge of edges) {
    let first = indexByKey.get(pointKey(edge.from))
    let second = indexByKey.get(pointKey(edge.to))
    if (first === undefined || second === undefined) {
      throw new Error("Layer-aware point-pair edge references an unknown terminal")
    }
    while (parent[first] !== first) first = parent[first]!
    while (parent[second] !== second) second = parent[second]!
    if (first === second) continue
    parent[second] = first
    output.push(edge)
    if (output.length === points.length - 1) break
  }
  if (output.length !== Math.max(0, points.length - 1)) {
    throw new Error("Layer-aware point-pair tree is incomplete")
  }
  return output
}

export function hasCoLocatedLayerTerminals(points: ConnectionPoint[]): boolean {
  const layersByPosition = new Map<string, string>()
  for (const point of points) {
    const position = `${point.x},${point.y}`
    const layers = [...getConnectionPointLayers(point)].sort().join("|")
    const previous = layersByPosition.get(position)
    if (previous !== undefined && previous !== layers) return true
    layersByPosition.set(position, layers)
  }
  return false
}
