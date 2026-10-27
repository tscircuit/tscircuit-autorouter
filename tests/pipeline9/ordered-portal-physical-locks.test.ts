import { expect, test } from "bun:test"
import { slidePipeline9OrderedPortals } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/slidePipeline9OrderedPortals"
import { createOrderedPortalFixture } from "./orderedPortalFixture"

test("portal contracts preserve anonymous physical terminals, labeled terminals and disabled input exactly", (): void => {
  const nodes = createOrderedPortalFixture()
  const portal = nodes[0]!.portPoints[1]!
  const result = slidePipeline9OrderedPortals({ nodes, obstacles: [], physicalTerminals: [{ x: portal.x, y: portal.y, z: portal.z }], layerCount: 2, traceWidth: 0.1, clearance: 0.15 })
  expect(result.stats.physicalTerminalCount).toBe(1)
  expect(result.stats.movedPortalCount).toBe(1)
  for (const node of result.nodes) expect(node.portPoints.find((point) => point.portPointId === portal.portPointId)).toEqual(portal)
  for (const node of nodes) node.portPoints.find((point) => point.portPointId === "seam-1")!.pcb_port_id = "physical-on-seam"
  const labeled = slidePipeline9OrderedPortals({ nodes, obstacles: [], physicalTerminals: [portal], layerCount: 2, traceWidth: 0.1, clearance: 0.15 })
  expect(labeled.stats.movedPortalCount).toBe(0)
  expect(labeled.nodes).toEqual(nodes)
  const disabled = slidePipeline9OrderedPortals({ nodes, obstacles: [], physicalTerminals: [], layerCount: 2, traceWidth: 0.1, clearance: 0.15, enabled: false })
  expect(disabled.nodes).toBe(nodes)
  expect(disabled.stats.sharedSeamCount).toBe(0)
})
