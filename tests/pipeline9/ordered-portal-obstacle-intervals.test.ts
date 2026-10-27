import { expect, test } from "bun:test"
import { slidePipeline9OrderedPortals } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/slidePipeline9OrderedPortals"
import { createOrderedPortalFixture } from "./orderedPortalFixture"

test("portal contracts stay within obstacle-free intervals on their own layer", (): void => {
  const nodes = createOrderedPortalFixture()
  for (const node of nodes) for (const point of node.portPoints) point.y = point.portPointId!.startsWith("seam") ? Math.sign(point.y) * 0.5 : Math.sign(point.y) * 0.1
  const obstacle = { type: "rect" as const, center: { x: 1, y: 0 }, width: 0.2, height: 0.2, layers: ["top"], connectedTo: [] }
  const params = { nodes, obstacles: [obstacle], physicalTerminals: [], layerCount: 2, traceWidth: 0.1, clearance: 0.1, requireStraightCellWitness: false }
  const result = slidePipeline9OrderedPortals(params)
  expect(result.stats.movedPortalCount).toBe(2)
  for (const node of result.nodes) for (const point of node.portPoints.filter((point) => point.portPointId!.startsWith("seam"))) {
    expect(Math.abs(point.y)).toBeCloseTo(0.25, 12)
    expect(Math.abs(point.y) - obstacle.height / 2 - params.traceWidth / 2).toBeGreaterThanOrEqual(params.clearance - 1e-12)
  }
  const otherLayer = slidePipeline9OrderedPortals({ ...params, obstacles: [{ ...obstacle, layers: ["bottom"] }] })
  expect(Math.abs(otherLayer.nodes[0]!.portPoints[1]!.y)).toBeCloseTo(0.1, 12)
})
