import type { Obstacle, SimpleRouteJson } from "../../lib/types"

type CongestionOptions = {
  srj: SimpleRouteJson
  random: () => number
  count: number
}

/** Add copper keepouts without moving any existing electrical terminal or pad. */
export function addBoardCongestion(options: CongestionOptions): void {
  const { srj, random, count } = options
  let added = 0
  for (let attempt = 0; attempt < count * 300 && added < count; attempt++) {
    const width = 0.25 + random() * 0.6
    const height = 0.25 + random() * 0.6
    const obstacle: Obstacle = {
      obstacleId: `mutation_keepout_${added}`,
      type: "rect",
      width,
      height,
      layers: [random() > 0.5 ? "top" : "bottom"],
      center: {
        x:
          srj.bounds.minX +
          1 +
          random() * (srj.bounds.maxX - srj.bounds.minX - 2),
        y:
          srj.bounds.minY +
          1 +
          random() * (srj.bounds.maxY - srj.bounds.minY - 2),
      },
      connectedTo: [],
    }
    if (
      srj.obstacles.some(
        (existing) =>
          Math.abs(existing.center.x - obstacle.center.x) <
            (existing.width + width) / 2 + 0.4 &&
          Math.abs(existing.center.y - obstacle.center.y) <
            (existing.height + height) / 2 + 0.4,
      )
    )
      continue
    if (
      srj.connections.some((connection) =>
        connection.pointsToConnect.some(
          (point) =>
            Math.abs(point.x - obstacle.center.x) < width / 2 + 0.4 &&
            Math.abs(point.y - obstacle.center.y) < height / 2 + 0.4,
        ),
      )
    )
      continue
    srj.obstacles.push(obstacle)
    added++
  }
  if (added !== count)
    throw new Error(`Could not place ${count} source-board keepouts`)
}
