import { Rect } from "graphics-debug"
import { CapacityMeshNode } from "lib/types"
import { getNodeBounds } from "./capacityMeshNodeGeometry"

export const createRectFromCapacityNode = (
  node: CapacityMeshNode,
  opts: {
    rectMargin?: number
    zOffset?: number
  } = {},
): Rect => {
  const lowestZ = Math.min(...node.availableZ)
  const bounds = getNodeBounds(node)
  return {
    center:
      !opts.rectMargin || opts.zOffset
        ? {
            x:
              (bounds.minX + bounds.maxX) / 2 +
              lowestZ * (bounds.maxX - bounds.minX) * (opts.zOffset ?? 0.05),
            y:
              (bounds.minY + bounds.maxY) / 2 -
              lowestZ * (bounds.maxX - bounds.minX) * (opts.zOffset ?? 0.05),
          }
        : {
            x: (bounds.minX + bounds.maxX) / 2,
            y: (bounds.minY + bounds.maxY) / 2,
          },
    width: opts.rectMargin
      ? bounds.maxX - bounds.minX - opts.rectMargin * 2
      : Math.max(
          bounds.maxX - bounds.minX - 0.5,
          (bounds.maxX - bounds.minX) * 0.8,
        ),
    height: opts.rectMargin
      ? bounds.maxY - bounds.minY - opts.rectMargin * 2
      : Math.max(
          bounds.maxY - bounds.minY - 0.5,
          (bounds.maxY - bounds.minY) * 0.8,
        ),
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
