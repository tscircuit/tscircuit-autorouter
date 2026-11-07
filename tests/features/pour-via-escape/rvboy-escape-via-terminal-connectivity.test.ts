import { expect, test } from "bun:test"
import type { GraphicsObject } from "graphics-debug"
import inputJson from "../../../fixtures/bug-reports/rvboy-escape-via-span/rvboy-native.srj.json"
import { renderRvboyRoutingView } from "../../../fixtures/bug-reports/rvboy-escape-via-span/renderRvboyRoutingView"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "../../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "../../../lib/types"

const input = inputJson as SimpleRouteJson

test("RVboy retains the ground pad's numerical bridge out of its closed pocket", async (): Promise<void> => {
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
  const bridges =
    solver.sharedEdgeSegmentsWithNecessaryCrampedPortPoints!.filter(
      (segment) =>
        segment.crossesNumericalGap &&
        segment.nodeIds.includes(target.capacityMeshNodeId) &&
        segment.start.y < target.center.y,
    )
  const ports = bridges
    .flatMap((segment) => segment.portPoints)
    .filter((port) => port.availableZ.includes(0))
  expect(ports.length).toBeGreaterThan(0)
  const viewbox = {
    minX: pad.center.x - 0.8,
    maxX: pad.center.x + 0.8,
    minY: pad.center.y - 0.95,
    maxY: pad.center.y + 0.01,
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
      fill: node._containsObstacle ? "#fecaca" : "#f1f5f9",
      stroke: "#64748b",
    })),
    circles: ports.map((port) => ({
      center: { x: port.x, y: port.y },
      radius: 0.025,
      fill: "#15803d",
      stroke: "#15803d",
    })),
    lines: bridges.map((bridge) => ({
      points: [bridge.start, bridge.end],
      strokeColor: "#15803d",
      strokeWidth: 0.012,
    })),
  }
  await expect(
    renderRvboyRoutingView(
      graphics,
      viewbox,
      "Ground-pad escape: numerical bridge retained",
      "Exact RVboy input; 0.000254 mm mesh gap. Green: usable topology port, not copper.",
    ),
  ).toMatchSvgSnapshot(import.meta.path)
})
