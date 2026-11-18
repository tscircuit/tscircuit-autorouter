import {
  getSvgFromGraphicsObject,
  type GraphicsObject,
  type Point,
  type Viewbox,
} from "graphics-debug"
import type { ExploredPortPoint } from "lib/solvers/NecessaryCrampedPortPointSolver/types"
import type { CapacityMeshNode } from "lib/types"
import { createRectFromCapacityNode } from "lib/utils/createRectFromCapacityNode"

export function renderButterstickCrampedEscape({
  nodes,
  targetNodeId,
  candidates,
  viewport,
  adjacencyEntries,
}: {
  nodes: CapacityMeshNode[]
  targetNodeId: CapacityMeshNode["capacityMeshNodeId"]
  candidates: ExploredPortPoint[]
  viewport: Viewbox
  adjacencyEntries: number
}): string {
  const target = nodes.find((node) => node.capacityMeshNodeId === targetNodeId)
  if (!target) throw new Error("Missing ButterStick source capacity region")
  const graphics: GraphicsObject = {
    coordinateSystem: "cartesian",
    rects: nodes
      .filter((node) =>
        node.availableZ.some((z) => target.availableZ.includes(z)),
      )
      .map((node) => ({
        ...createRectFromCapacityNode(node, { rectMargin: 0.001, zOffset: 0 }),
        fill:
          node.capacityMeshNodeId === targetNodeId
            ? "rgba(251, 191, 36, 0.12)"
            : node._containsObstacle
              ? "rgba(239, 68, 68, 0.12)"
              : "rgba(59, 130, 246, 0.06)",
        stroke: "#64748b",
      })),
    circles: candidates.map(({ port }) => ({
      center: { x: port.x, y: port.y },
      radius: 0.012,
      fill: "#15803d",
      stroke: "#15803d",
    })),
    lines: candidates.map((candidate) => {
      const points: Point[] = []
      let parent: ExploredPortPoint | null = candidate
      while (parent) {
        points.unshift({ x: parent.port.x, y: parent.port.y })
        parent = parent.parent
      }
      return { points, strokeColor: "#15803d", strokeWidth: 0.012 }
    }),
  }
  graphics.rects!.push({
    center: {
      x: (viewport.minX + viewport.maxX) / 2,
      y: (viewport.minY + viewport.maxY) / 2,
    },
    width: viewport.maxX - viewport.minX,
    height: viewport.maxY - viewport.minY,
    fill: "none",
    stroke: "none",
    label: "butterstick-escape-viewport",
  })
  const svg = getSvgFromGraphicsObject(graphics, {
    backgroundColor: "white",
    svgWidth: 1100,
    svgHeight: 700,
    includeTextLabels: false,
  })
  const frame = svg.match(
    /<rect\b[^>]*data-label="butterstick-escape-viewport"[^>]*\/>/,
  )
  if (!frame) throw new Error("Missing ButterStick escape viewport")
  const coordinates = ["x", "y", "width", "height"].map((attribute) => {
    const match = frame[0].match(new RegExp(`\\s${attribute}="([^"]+)"`))
    if (!match) throw new Error(`Missing escape viewport ${attribute}`)
    return Number(match[1])
  })
  const cropped = svg.replace(
    /<svg\b[^>]*>/,
    `<svg x="0" y="110" width="1100" height="700" viewBox="${coordinates.join(" ")}" overflow="hidden" xmlns="http://www.w3.org/2000/svg">`,
  )
  return `<svg width="1100" height="810" viewBox="0 0 1100 810" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/><text x="24" y="31" font-family="sans-serif" font-size="23">ButterStick: native plane-escape graph cut</text><text x="24" y="62" font-family="sans-serif" font-size="20">Adjacency entries examined: ${adjacencyEntries.toLocaleString("en-US")} · candidates: ${candidates.length}</text><text x="24" y="91" font-family="sans-serif" font-size="16">Amber: source region. Red: z3 obstacles. Green: projected z3/z4 search paths. Preparation, not copper.</text>${cropped}</svg>`
}
