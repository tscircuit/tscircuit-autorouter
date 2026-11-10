import { type GraphicsObject, getSvgFromGraphicsObject } from "graphics-debug"
import type { TopologyMergingSolver } from "lib/solvers/TopologyMergingSolver/TopologyMergingSolver"
import { createTopologyMergingOutputNodes } from "lib/solvers/TopologyMergingSolver/topology-merging-output"
import { createRectFromCapacityNode } from "lib/utils/createRectFromCapacityNode"

export function getStmp157MeshSnapshotSvg(
  solver: TopologyMergingSolver,
): string {
  const view = { minX: -18.5, maxX: -16.5, minY: -6, maxY: -4.5 }
  // Crop retained regions before the native visualize() conversion so drawing
  // this diagnostic does not allocate hundreds of thousands of off-screen nodes.
  const regions = solver["atomicRegions"].filter(
    ({ bounds, availableZ }) =>
      availableZ.includes(0) &&
      bounds.maxX > view.minX &&
      bounds.minX < view.maxX &&
      bounds.maxY > view.minY &&
      bounds.minY < view.maxY,
  )
  const nodes = createTopologyMergingOutputNodes({
    regions,
    preparedNodeBySourceKey: solver["preparedNodeBySourceKey"],
    nodeGroups: solver.inputProblem.nodeGroups,
    provenance: {
      groupIndexesByNodeId: new Map(),
      sourceKeysByNodeId: new Map(),
    },
    preserveSourceIds: false,
  })
  const rects = nodes.map((node) => {
    const minX = Math.max(view.minX, node.center.x - node.width / 2)
    const maxX = Math.min(view.maxX, node.center.x + node.width / 2)
    const minY = Math.max(view.minY, node.center.y - node.height / 2)
    const maxY = Math.min(view.maxY, node.center.y + node.height / 2)
    return {
      ...createRectFromCapacityNode(node),
      // Show exact bounds without the native debug inset or layer offset.
      center: {
        x: (minX + maxX) / 2 - view.minX,
        y: (minY + maxY) / 2 - view.minY,
      },
      width: maxX - minX,
      height: maxY - minY,
      stroke: node._containsObstacle ? "#bf7373" : "#4c7897",
      label: undefined,
    }
  })
  const graphics: GraphicsObject = {
    coordinateSystem: "cartesian",
    rects,
    // Explicit edges keep subpixel cell boundaries visible in the SVG.
    lines: rects.map(({ center, width, height, stroke }) => {
      const minX = center.x - width / 2
      const maxX = center.x + width / 2
      const minY = center.y - height / 2
      const maxY = center.y + height / 2
      return {
        points: [
          { x: minX, y: minY },
          { x: maxX, y: minY },
          { x: maxX, y: maxY },
          { x: minX, y: maxY },
          { x: minX, y: minY },
        ],
        strokeColor: stroke,
        strokeWidth: 0.0016,
      }
    }),
    texts: [
      {
        x: 0,
        y: 2.05,
        text: "STMP157 DDR · top-layer mesh",
        fontSize: 0.085,
        anchorSide: "center_left",
      },
      {
        x: 0,
        y: 1.87,
        text: `X slices: ${solver.stats.processedXSlabCount} / ${solver.stats.xSlabCount}`,
        fontSize: 0.07,
        anchorSide: "center_left",
      },
      {
        x: 0,
        y: 1.69,
        text: `${rects.length} cells in this 2 × 1.5 mm crop`,
        fontSize: 0.07,
        anchorSide: "center_left",
      },
      {
        x: 0,
        y: -0.18,
        text: `Whole mesh: ${solver.stats.atomicRegionCount} retained cells`,
        fontSize: 0.067,
        anchorSide: "center_left",
      },
    ],
  }
  return getSvgFromGraphicsObject(graphics, {
    backgroundColor: "white",
    svgWidth: 1200,
    svgHeight: 1200,
  })
}
