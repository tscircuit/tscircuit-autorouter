import { expect, test } from "bun:test"
import { slidePipeline9OrderedPortals } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/slidePipeline9OrderedPortals"
import { createOrderedPortalFixture } from "./orderedPortalFixture"

test("opposing route targets cannot swap boundary permutation or collapse finite-width lanes", (): void => {
  const nodes = createOrderedPortalFixture()
  for (const node of nodes) for (const point of node.portPoints) if (!point.portPointId!.startsWith("seam")) point.y *= -1
  const result = slidePipeline9OrderedPortals({ nodes, obstacles: [], physicalTerminals: [], layerCount: 2, traceWidth: 0.1, clearance: 0.15, requireStraightCellWitness: false })
  expect(result.stats.movedPortalCount).toBe(2)
  const contacts = result.nodes.map((node) => node.portPoints.filter((point) => point.portPointId!.startsWith("seam")).sort((a, b) => a.y - b.y))
  for (const ports of contacts) {
    expect(ports.map((point) => point.portPointId)).toEqual(["seam-0", "seam-1"])
    expect(ports[1]!.y - ports[0]!.y).toBeCloseTo(0.25, 12)
  }
  expect(contacts[0]).toEqual(contacts[1])
})
