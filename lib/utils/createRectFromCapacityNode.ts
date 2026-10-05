import { Rect } from "graphics-debug"
import { CapacityMeshNode } from "lib/types"

export const createRectFromCapacityNode = (
  node: CapacityMeshNode,
  opts: {
    rectMargin?: number
    zOffset?: number
  } = {},
): Rect => {
  const lowestZ = Math.min(...node.availableZ)
  return {
    center:
      !opts.rectMargin || opts.zOffset
        ? {
            x: node.center.x + lowestZ * node.width * (opts.zOffset ?? 0.05),
            y: node.center.y - lowestZ * node.width * (opts.zOffset ?? 0.05),
          }
        : node.center,
    width: opts.rectMargin
      ? node.width - opts.rectMargin * 2
      : Math.max(node.width - 0.5, node.width * 0.8),
    height: opts.rectMargin
      ? node.height - opts.rectMargin * 2
      : Math.max(node.height - 0.5, node.height * 0.8),
    fill: node._containsObstacle
      ? "rgba(255,0,0,0.1)"
      : ({
          "0,1": "rgba(0,0,0,0.1)",
          "0": "rgba(0,200,200, 0.1)",
          "1": "rgba(0,0,200, 0.1)",
        }[node.availableZ.join(",")] ?? "rgba(0,200,200,0.1)"),
    layer: `z${node.availableZ.join(",")}`,
    label: [
      node.capacityMeshNodeId,
      `availableZ: ${node.availableZ.join(",")}`,
      `${node._containsTarget ? "containsTarget" : ""}`,
      `${node._containsObstacle ? "containsObstacle" : ""}`,
    ]
      .filter(Boolean)
      .join("\n"),
  }
}
