import { minimumDistanceBetweenSegments } from "./minimumDistanceBetweenSegments"
import { isViaInKeepout } from "./isViaInKeepout"
import type { CapacityMeshNode } from "lib/types/capacity-mesh-types"
import type { ViaKeepout } from "lib/types/srj-types"
import { mapLayerNameToZ } from "./mapLayerNameToZ"
import { mapZToLayerName } from "./mapZToLayerName"

type Bounds = { minX: number; maxX: number; minY: number; maxY: number }

/** Board-world points in mm (+X right, +Y up). Bounds include the via copper radius. */
function getForbiddenBounds(keepout: ViaKeepout, diameter: number): Bounds[] {
  if (keepout.shape === "outline") {
    const margin = (diameter + keepout.strokeWidth) / 2
    return keepout.outline.slice(1).map((end, i) => {
      const start = keepout.outline[i]
      return {
        minX: Math.min(start.x, end.x) - margin,
        maxX: Math.max(start.x, end.x) + margin,
        minY: Math.min(start.y, end.y) - margin,
        maxY: Math.max(start.y, end.y) + margin,
      }
    })
  }
  const rx =
    (keepout.shape === "circle" ? keepout.radius : keepout.width / 2) +
    diameter / 2
  const ry =
    (keepout.shape === "circle" ? keepout.radius : keepout.height / 2) +
    diameter / 2
  return [
    {
      minX: keepout.center.x - rx,
      maxX: keepout.center.x + rx,
      minY: keepout.center.y - ry,
      maxY: keepout.center.y + ry,
    },
  ]
}

/** Board-world rectangle/keepout distance in mm; no trace obstacle is introduced. */
function intersectsCopper(
  node: CapacityMeshNode,
  keepout: ViaKeepout,
  diameter: number,
): boolean {
  const dx =
    keepout.shape === "outline"
      ? 0
      : Math.max(Math.abs(node.center.x - keepout.center.x) - node.width / 2, 0)
  const dy =
    keepout.shape === "outline"
      ? 0
      : Math.max(
          Math.abs(node.center.y - keepout.center.y) - node.height / 2,
          0,
        )
  if (keepout.shape === "circle")
    return Math.hypot(dx, dy) < keepout.radius + diameter / 2 - 1e-9
  if (keepout.shape === "rect")
    return (
      Math.hypot(
        Math.max(dx - keepout.width / 2, 0),
        Math.max(dy - keepout.height / 2, 0),
      ) <
      diameter / 2 - 1e-9
    )
  const corners = [-1, 1].flatMap((x) =>
    [-1, 1].map((y) => ({
      x: node.center.x + (x * node.width) / 2,
      y: node.center.y + (y * node.height) / 2,
    })),
  )
  const edges = [
    [0, 1],
    [1, 3],
    [3, 2],
    [2, 0],
  ]
  return keepout.outline.slice(1).some((end, i) => {
    const start = keepout.outline[i]
    if (
      Math.abs(start.x - node.center.x) <= node.width / 2 &&
      Math.abs(start.y - node.center.y) <= node.height / 2
    )
      return true
    return edges.some(
      ([a, b]) =>
        minimumDistanceBetweenSegments(start, end, corners[a], corners[b]) <
        (diameter + keepout.strokeWidth) / 2 - 1e-9,
    )
  })
}

/** Refine only curved/diagonal boundaries; free interiors keep their original size. */
function partitionBoundary(
  node: CapacityMeshNode,
  keepout: ViaKeepout,
  diameter: number,
  layerCount: number,
): CapacityMeshNode[] {
  if (!intersectsCopper(node, keepout, diameter)) return [node]
  const allCornersInside = [-1, 1].every((x) =>
    [-1, 1].every((y) =>
      isViaInKeepout(
        {
          x: node.center.x + (x * node.width) / 2,
          y: node.center.y + (y * node.height) / 2,
        },
        diameter,
        [keepout],
        layerCount,
      ),
    ),
  )
  // Bounded geometric approximation, not a global mesh-size workaround. At a
  // boundary only, the excluded fringe is at most this cell's diagonal.
  const tolerance = Math.max(0.05, diameter)
  if (allCornersInside || Math.max(node.width, node.height) <= tolerance)
    return [node]
  const splitX = node.width >= node.height
  return [-1, 1].flatMap((side, i) =>
    partitionBoundary(
      {
        ...node,
        capacityMeshNodeId: `${node.capacityMeshNodeId}_b${i}`,
        center: {
          x: node.center.x + (splitX ? (side * node.width) / 4 : 0),
          y: node.center.y + (splitX ? 0 : (side * node.height) / 4),
        },
        width: splitX ? node.width / 2 : node.width,
        height: splitX ? node.height : node.height / 2,
      },
      keepout,
      diameter,
      layerCount,
    ),
  )
}

/**
 * Board-world points in mm (+X right, +Y up). Partition at expanded keepout
 * boundaries before separating layers, so a tiny keepout cannot consume a whole
 * otherwise free mesh cell. Only the intersecting subrectangles lose transitions.
 * Curved/diagonal boundaries are refined locally; ordinary planar copper remains allowed.
 */
export function splitNodesAtViaKeepouts(
  nodes: CapacityMeshNode[],
  keepouts: ViaKeepout[],
  viaDiameter: number,
  layerCount: number,
  allowBlindAndBuriedVias = false,
): CapacityMeshNode[] {
  if (keepouts.length === 0) return nodes
  let output = nodes
  const convexKeepouts = keepouts.flatMap<ViaKeepout>((keepout) =>
    keepout.shape === "outline"
      ? keepout.outline
          .slice(1)
          .map((end, i) => ({ ...keepout, outline: [keepout.outline[i], end] }))
      : [keepout],
  )
  for (const keepout of convexKeepouts) {
    const forbiddenZ = keepout.layers
      .map((layer) => mapLayerNameToZ(layer, layerCount))
      .filter((z) => z >= 0 && z < layerCount)
    if (!forbiddenZ.length) continue
    for (const bounds of getForbiddenBounds(keepout, viaDiameter)) {
      output = output.flatMap((node) => {
        if (node.availableZ.length < 2 || node._isVirtualOffboard) return [node]
        const left = node.center.x - node.width / 2,
          right = node.center.x + node.width / 2
        const bottom = node.center.y - node.height / 2,
          top = node.center.y + node.height / 2
        if (
          right <= bounds.minX ||
          left >= bounds.maxX ||
          top <= bounds.minY ||
          bottom >= bounds.maxY
        )
          return [node]
        // Existing target copper is one planar object per layer. Spatially
        // fragmenting it creates interior target regions with no routing edge.
        // Keep its full footprint on each layer; multilayer terminal access is
        // represented by the graph junction, never by drilling a new via here.
        if (node._containsObstacle && node._containsTarget) {
          return node.availableZ.map((z) => ({
            ...node,
            capacityMeshNodeId: `${node.capacityMeshNodeId}_vk_copper_${z}`,
            availableZ: [z],
            layer: mapZToLayerName(z, layerCount),
            _parent: node,
          }))
        }
        const xs = [
          left,
          ...[bounds.minX, bounds.maxX].filter((x) => x > left && x < right),
          right,
        ]
        const ys = [
          bottom,
          ...[bounds.minY, bounds.maxY].filter((y) => y > bottom && y < top),
          top,
        ]
        const children: CapacityMeshNode[] = []
        for (let xi = 0; xi < xs.length - 1; xi++) {
          for (let yi = 0; yi < ys.length - 1; yi++) {
            const x = (xs[xi] + xs[xi + 1]) / 2,
              y = (ys[yi] + ys[yi + 1]) / 2
            const cell = {
              ...node,
              capacityMeshNodeId: `${node.capacityMeshNodeId}_vk_${xi}_${yi}`,
              center: { x, y },
              width: xs[xi + 1] - xs[xi],
              height: ys[yi + 1] - ys[yi],
              _parent: node,
            }
            for (const part of keepout.shape === "outline" ||
            (keepout.shape === "circle" &&
              Math.max(cell.width, cell.height) > 2 * viaDiameter)
              ? partitionBoundary(cell, keepout, viaDiameter, layerCount)
              : [cell]) {
              const inside = intersectsCopper(part, keepout, viaDiameter)
              const groups: number[][] = []
              for (const z of [...node.availableZ].sort((a, b) => a - b)) {
                const previous = groups[groups.length - 1]
                if (
                  !inside ||
                  (allowBlindAndBuriedVias &&
                    previous &&
                    !forbiddenZ.some((fz) => fz >= previous[0] && fz <= z))
                ) {
                  if (previous) previous.push(z)
                  else groups.push([z])
                } else groups.push([z])
              }
              for (const availableZ of groups)
                children.push({
                  ...part,
                  capacityMeshNodeId: `${part.capacityMeshNodeId}_${availableZ.join("-")}`,
                  availableZ,
                  layer: mapZToLayerName(availableZ[0], layerCount),
                  _parent: node,
                })
            }
          }
        }
        return children
      })
    }
  }
  return output
}
