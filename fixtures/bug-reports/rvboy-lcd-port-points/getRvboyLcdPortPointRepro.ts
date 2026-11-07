import {
  getSvgFromGraphicsObject,
  type GraphicsObject,
  type Viewbox,
} from "graphics-debug"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { CapacityMeshNode, SimpleRouteJson } from "lib/types"
import { createRectFromCapacityNode } from "lib/utils/createRectFromCapacityNode"
import inputJson from "./rvboy-phase1.srj.json"

const input = inputJson as SimpleRouteJson

type LcdView = {
  name: string
  svg: string
  sideEdgeCount: number
  usableSideEdgeCount: number
}

/** Crop only the drawing. Every obstacle, connection and preloaded trace is solved. */
function renderView(
  graphics: GraphicsObject,
  viewbox: Viewbox,
  title: string,
): string {
  const frame = {
    center: {
      x: (viewbox.minX + viewbox.maxX) / 2,
      y: (viewbox.minY + viewbox.maxY) / 2,
    },
    width: viewbox.maxX - viewbox.minX,
    height: viewbox.maxY - viewbox.minY,
    fill: "none",
    stroke: "none",
    label: "rvboy-viewport",
  }
  const svg = getSvgFromGraphicsObject(
    { ...graphics, rects: [...graphics.rects!, frame] },
    { backgroundColor: "white", svgWidth: 1000, svgHeight: 600 },
  )
  const frameTag = svg.match(/<rect\b[^>]*data-label="rvboy-viewport"[^>]*\/>/)
  if (!frameTag) throw new Error("Missing viewport rectangle in graphics SVG")
  const coordinates = ["x", "y", "width", "height"].map((attribute) => {
    const match = frameTag[0].match(new RegExp(`\\s${attribute}="([^"]+)"`))
    if (!match) throw new Error(`Missing SVG viewport ${attribute}`)
    return Number(match[1])
  })
  const cropped = svg.replace(
    /<svg\b[^>]*>/,
    `<svg x="0" y="80" width="1000" height="600" viewBox="${coordinates.join(" ")}" overflow="hidden" xmlns="http://www.w3.org/2000/svg">`,
  )
  return `<svg width="1000" height="680" viewBox="0 0 1000 680" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/><text x="24" y="30" font-family="sans-serif" font-size="22">${title}</text><text x="24" y="59" font-family="sans-serif" font-size="16">Dots: top-layer ports | Red: missing port | Green: usable edge (topology, not copper)</text>${cropped}</svg>`
}

function getLcdView(
  solver: AutoroutingPipelineSolver9_PreloadedTraceGraph,
  portId: string,
  pin: number,
): LcdView {
  const nodes = solver.capacityNodes!
  const ports = solver.availableSegmentPointSolver!
  const pad = input.obstacles.find(
    (obstacle) => obstacle.circuitJsonMetadata?.pcb_port_id === portId,
  )
  if (!pad) throw new Error(`Missing LCD pad ${portId}`)
  const target = nodes.find(
    (node) =>
      node._containsTarget &&
      Math.abs(node.center.x - pad.center.x) < 1e-7 &&
      Math.abs(node.center.y - pad.center.y) < 1e-7,
  )
  if (!target) throw new Error(`Missing LCD target ${portId}`)
  const viewbox: Viewbox = {
    minX: target.center.x - 1.9,
    maxX: target.center.x + 1.9,
    minY: target.center.y - 1.14,
    maxY: target.center.y + 1.14,
  }
  const visibleNodes = nodes.filter(
    (node) =>
      node.availableZ.includes(0) &&
      node.center.x + node.width / 2 >= viewbox.minX &&
      node.center.x - node.width / 2 <= viewbox.maxX &&
      node.center.y + node.height / 2 >= viewbox.minY &&
      node.center.y - node.height / 2 <= viewbox.maxY,
  )
  const visible = (point: { x: number; y: number }): boolean => {
    return (
      point.x >= viewbox.minX &&
      point.x <= viewbox.maxX &&
      point.y >= viewbox.minY &&
      point.y <= viewbox.maxY
    )
  }
  const nativeGraphics = ports.visualize()
  const graphics: GraphicsObject = {
    circles: nativeGraphics.circles!.filter(
      (circle) => circle.layer === "z0" && visible(circle.center),
    ),
    rects: visibleNodes.map((node) => ({
      ...createRectFromCapacityNode(node),
      center: node.center,
      width: node.width,
      height: node.height,
    })),
    lines: [],
    texts: [
      {
        x: target.center.x,
        y: target.center.y,
        text: `LCD pin ${pin}`,
        fontSize: 0.13,
        anchorSide: "center",
        color: "#111",
      },
    ],
  }
  const nodeById = new Map(nodes.map((node) => [node.capacityMeshNodeId, node]))
  let sideEdgeCount = 0
  let usableSideEdgeCount = 0
  for (const edge of solver.capacityEdges!) {
    if (!edge.nodeIds.includes(target.capacityMeshNodeId)) continue
    const neighborId = edge.nodeIds.find(
      (id) => id !== target.capacityMeshNodeId,
    )!
    const neighbor: CapacityMeshNode = nodeById.get(neighborId)!
    if (neighbor._containsObstacle || !neighbor.availableZ.includes(0)) continue
    if (Math.abs(neighbor.center.x - target.center.x) < target.width / 2)
      continue
    sideEdgeCount++
    const topPorts = ports
      .getAvailablePortPointsBetweenNodes(target.capacityMeshNodeId, neighborId)
      .filter((port) => port.availableZ.includes(0))
    const usable = topPorts.length > 0
    if (usable) usableSideEdgeCount++
    const boundary = usable
      ? topPorts[0]!
      : {
          x:
            target.center.x +
            ((neighbor.center.x < target.center.x ? -1 : 1) * target.width) / 2,
          y: target.center.y,
        }
    graphics.lines!.push({
      points: [neighbor.center, boundary],
      strokeColor: usable ? "#15803d" : "#dc2626",
      strokeWidth: input.minTraceWidth / 2,
      label: `${edge.capacityMeshEdgeId}: ${topPorts.length} top-layer ports`,
    })
  }
  return {
    name: `lcd-pin${pin}`,
    sideEdgeCount,
    usableSideEdgeCount,
    svg: renderView(
      graphics,
      viewbox,
      `RVboy LCD pin ${pin}: ${usableSideEdgeCount}/${sideEdgeCount} side edges have top-layer ports`,
    ),
  }
}

export function getRvboyLcdPortPointRepro(): {
  solver: AutoroutingPipelineSolver9_PreloadedTraceGraph
  views: LcdView[]
} {
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(input),
  )
  while (
    !solver.failed &&
    !solver.solved &&
    !solver.availableSegmentPointSolver?.solved
  )
    solver.step()
  if (solver.failed || !solver.availableSegmentPointSolver?.solved) {
    throw new Error(solver.error ?? "Port-point generation did not complete")
  }
  return {
    solver,
    views: [
      getLcdView(solver, "pcb_port_704", 30),
      getLcdView(solver, "pcb_port_717", 43),
    ],
  }
}
