import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("SRJ18 sample 6 keeps planned component escapes without numerical shortcuts", async () => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 6)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(scenario, {
    cacheProvider: null,
    effort: 1,
  })
  while (!solver.failed && !solver.availableSegmentPointSolver?.solved) {
    solver.step()
  }
  expect(solver.failed).toBe(false)
  const ports = solver.availableSegmentPointSolver!
  const componentSegments = ports
    .getOutput()
    .filter((segment) =>
      segment.nodeIds.some(
        (nodeId) => ports.nodeMap.get(nodeId)!._isComponentTopologyNode,
      ),
    )
  expect(componentSegments.length).toBeGreaterThan(0)
  expect(
    componentSegments.some((segment) =>
      segment.portPoints.some((port) => port.cramped),
    ),
  ).toBe(true)
  // These cramped crossings are deliberately retained by component topology.
  // Treating them as blocked added shortcuts and nearly doubled routing time.
  expect(
    componentSegments.filter((segment) => segment.crossesNumericalGap),
  ).toEqual([])
})
