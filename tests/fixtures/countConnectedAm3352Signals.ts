import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"

/** Check all source terminals against continuous emitted centerline/via paths. */
export function countConnectedAm3352Signals(
  srj: SimpleRouteJson,
  routes: HighDensityRoute[],
): number {
  const key = (point: { x: number; y: number; z: number }): string =>
    `${point.x.toFixed(6)},${point.y.toFixed(6)},${point.z}`
  return srj.connections.filter((connection): boolean => {
    const graph = new Map<string, Set<string>>()
    for (const route of routes) {
      if (
        (route.rootConnectionName ?? route.connectionName) !== connection.name
      )
        continue
      for (let index = 1; index < route.route.length; index++) {
        const a = route.route[index - 1]!,
          b = route.route[index]!
        if (a.z !== b.z && Math.hypot(a.x - b.x, a.y - b.y) > 1e-6) return false
        const from = key(a),
          to = key(b)
        if (!graph.has(from)) graph.set(from, new Set())
        if (!graph.has(to)) graph.set(to, new Set())
        graph.get(from)!.add(to)
        graph.get(to)!.add(from)
      }
    }
    const terminals = connection.pointsToConnect.map((point) =>
      (point.layers ?? [point.layer]).map((layer) =>
        key({ ...point, z: mapLayerNameToZ(layer, srj.layerCount) }),
      ),
    )
    const start = terminals[0]?.find((terminal) => graph.has(terminal))
    if (start === undefined) return false
    const visited = new Set([start]),
      queue = [start]
    for (let cursor = 0; cursor < queue.length; cursor++) {
      for (const neighbor of graph.get(queue[cursor]!)!) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor)
          queue.push(neighbor)
        }
      }
    }
    return terminals.every((choices) =>
      choices.some((terminal) => visited.has(terminal)),
    )
  }).length
}
