import { expect, test } from "bun:test"
import type { GraphicsObject } from "graphics-debug"
import type { SegmentPortPoint } from "../../../lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import { getConnectionEscapePortPoints } from "../../../lib/solvers/AvailableSegmentPointSolver/getConnectionEscapePortPoints"
import inputJson from "../../../fixtures/bug-reports/rvboy-escape-via-span/rvboy-native.srj.json"
import { renderRvboyRoutingView } from "../../../fixtures/bug-reports/rvboy-escape-via-span/renderRvboyRoutingView"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "../../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "../../../lib/types"

const input = inputJson as SimpleRouteJson

test("RVboy ground pad retains access to its requested routing destinations", async (): Promise<void> => {
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(input),
    { cacheProvider: null },
  )
  while (
    solver.getCurrentPhase() !== "portPointPathingSolver" &&
    !solver.failed
  ) {
    solver.step()
  }
  expect(solver.failed).toBe(false)
  const pad = input.obstacles.find(
    (obstacle) => obstacle.circuitJsonMetadata?.pcb_port_id === "pcb_port_34",
  )!
  const target = solver.capacityNodes!.find(
    (node) =>
      node._containsTarget &&
      node.availableZ.includes(0) &&
      Math.hypot(node.center.x - pad.center.x, node.center.y - pad.center.y) <
        1e-6,
  )!
  expect(target).toBeDefined()
  const segments = solver.sharedEdgeSegmentsWithNecessaryCrampedPortPoints!
  const portsByNodeId = new Map<string, SegmentPortPoint[]>()
  for (const segment of segments) {
    for (const port of segment.portPoints) {
      for (const nodeId of port.nodeIds) {
        if (!portsByNodeId.has(nodeId)) portsByNodeId.set(nodeId, [])
        portsByNodeId.get(nodeId)!.push(port)
      }
    }
  }
  const connections = solver.srjWithPointPairs!.connections.filter(
    (connection) =>
      connection.pointsToConnect.some(
        (point) => point.pcb_port_id === "pcb_port_34",
      ),
  )
  expect(connections.length).toBeGreaterThan(0)
  // Reusing existing plane vias changes the MST destinations. Check that the
  // retained graph reaches those destinations, not one obsolete downward edge.
  const escapePorts = getConnectionEscapePortPoints({
    target,
    nodes: solver.capacityNodes!,
    nodeMap: new Map(
      solver.capacityNodes!.map((node) => [node.capacityMeshNodeId, node]),
    ),
    portsByNodeId,
    connections,
    allowCrampedPortPoints: true,
  })
  expect(escapePorts).toBeDefined()
  const ports = Array.from(escapePorts!)
  expect(ports.length).toBeGreaterThan(0)
  const crossings = segments.filter((segment) =>
    segment.portPoints.some((port) => escapePorts!.has(port)),
  )
  const viewbox = {
    minX: pad.center.x - 1.5,
    maxX: pad.center.x + 1.5,
    minY: pad.center.y - 0.5,
    maxY: pad.center.y + 3,
  }
  const visibleNodes = solver.capacityNodes!.filter(
    (node) =>
      node.availableZ.includes(0) &&
      node.center.x + node.width / 2 >= viewbox.minX &&
      node.center.x - node.width / 2 <= viewbox.maxX &&
      node.center.y + node.height / 2 >= viewbox.minY &&
      node.center.y - node.height / 2 <= viewbox.maxY,
  )
  const graphics: GraphicsObject = {
    coordinateSystem: "cartesian",
    rects: visibleNodes.map((node) => ({
      center: node.center,
      width: node.width,
      height: node.height,
      fill:
        node.capacityMeshNodeId === target.capacityMeshNodeId
          ? "#fbbf24"
          : node._containsObstacle
            ? "#fecaca"
            : "#f1f5f9",
      stroke: "#64748b",
    })),
    circles: ports.map((port) => ({
      center: { x: port.x, y: port.y },
      radius: 0.025,
      fill: port.availableZ.includes(0) ? "#15803d" : "#2563eb",
      stroke: port.availableZ.includes(0) ? "#15803d" : "#2563eb",
    })),
    lines: crossings.map((crossing) => ({
      points: [crossing.start, crossing.end],
      strokeColor: crossing.availableZ.includes(0) ? "#15803d" : "#2563eb",
      strokeWidth: 0.012,
    })),
  }
  await expect(
    renderRvboyRoutingView(
      graphics,
      viewbox,
      "RVboy ground pad: requested destinations remain reachable",
      "Amber: ground pad. Green: top crossings. Blue: bottom crossings. Routing graph only, not copper.",
    ),
  ).toMatchSvgSnapshot(import.meta.path)
})
