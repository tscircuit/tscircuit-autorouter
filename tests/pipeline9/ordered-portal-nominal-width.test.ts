import { expect, test } from "bun:test"
import { slidePipeline9OrderedPortals } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/slidePipeline9OrderedPortals"
import { createOrderedPortalFixture } from "./orderedPortalFixture"

test("portal lanes reserve requested per-net nominal widths without assuming a later neckdown", (): void => {
  const nodes = createOrderedPortalFixture()
  for (const node of nodes) for (const point of node.portPoints) if (!point.portPointId!.startsWith("seam")) point.y = Math.sign(point.y) * 0.05
  const result = slidePipeline9OrderedPortals({ nodes, obstacles: [], physicalTerminals: [], layerCount: 2, traceWidth: 0.1, clearance: 0.1,
    traceWidthByConnectionName: new Map([["root-0", 0.6], ["connection-1", 0.2]]), requireStraightCellWitness: false,
  })
  expect(result.stats.nominalWidthPortalCount).toBe(2)
  expect(result.stats.maxReservedTraceWidth).toBe(0.6)
  const portals = result.nodes[0]!.portPoints.filter((point) => point.portPointId!.startsWith("seam")).sort((a, b) => a.y - b.y)
  expect(portals[1]!.y - portals[0]!.y).toBeCloseTo((0.6 + 0.2) / 2 + 0.1, 12)
  // Independent varied bounds and varied pitch can force a pooled allocation.
  expect(result.stats.movedPortalCount).toBe(2)
  expect(result.stats.widthRepairRunCount).toBe(1)
  const narrow = slidePipeline9OrderedPortals({ nodes, obstacles: [], physicalTerminals: [], layerCount: 2, traceWidth: 0.1, clearance: 0.1,
    traceWidthByConnectionName: new Map([["root-0", 0.9], ["connection-1", 0.9]]),
  })
  expect(narrow.stats.insufficientWidthRunCount).toBe(1)
  expect(narrow.stats.movedPortalCount).toBe(0)
  expect(narrow.nodes).toEqual(nodes)
})
