import { expect, test } from "bun:test"
import { slidePipeline9OrderedPortals } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/slidePipeline9OrderedPortals"
import { createOrderedPortalFixture } from "./orderedPortalFixture"

test("portal optimization cannot move shared copper through the physical board edge", (): void => {
  const nodes = createOrderedPortalFixture()
  const result = slidePipeline9OrderedPortals({ nodes, obstacles: [], physicalTerminals: [], layerCount: 2, traceWidth: 0.1, clearance: 0.15,
    boardGeometry: { bounds: { minX: 0, maxX: 2, minY: -0.5, maxY: 0.5 }, minBoardEdgeClearance: 0.05 },
  })
  expect(result.stats.boardClearanceRejectedRunCount).toBe(1)
  expect(result.stats.movedPortalCount).toBe(0)
  expect(result.nodes).toEqual(nodes)
})
