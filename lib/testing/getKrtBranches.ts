import type { ConnectionPoint, SimpleRouteJson } from "lib/types"
import type { KrtBranch } from "./prepareKrtBranches"

/** Select exact original terminal edges without preparing backend geometry. */
export const getKrtBranches = (original: SimpleRouteJson): KrtBranch[] => {
  const branches: KrtBranch[] = []
  for (const connection of original.connections) {
    if (connection.pointsToConnect.length < 2) continue
    const attached = new Set([0])
    while (attached.size < connection.pointsToConnect.length) {
      let edge = { from: -1, to: -1, distance: Infinity }
      for (const from of attached) {
        for (let to = 0; to < connection.pointsToConnect.length; to++) {
          if (attached.has(to)) continue
          const a = connection.pointsToConnect[from]
          const b = connection.pointsToConnect[to]
          const distance = Math.hypot(a.x - b.x, a.y - b.y)
          if (distance < edge.distance) edge = { from, to, distance }
        }
      }
      if (edge.to < 0) {
        throw new Error(`No finite terminal edge for ${connection.name}`)
      }
      attached.add(edge.to)
      const points: [ConnectionPoint, ConnectionPoint] = [
        connection.pointsToConnect[edge.from],
        connection.pointsToConnect[edge.to],
      ]
      branches.push({ name: `krt_branch_${branches.length}`, connection, points })
    }
  }
  return branches
}
