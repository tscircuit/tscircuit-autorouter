import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { CapacityMeshEdgeSolver } from "lib/solvers/CapacityMeshSolver/CapacityMeshEdgeSolver"
import { loadScenarioBySampleNumber } from "scripts/benchmark/scenarios"
import { getGraphicsSvgFrames } from "tests/fixtures/solver-svg-frames"

test("PMP22650 preserves topology and target access through edge finalization", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj24", 24)
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(scenario, {
    effort: 1,
    cacheProvider: null,
  })

  while (
    pipeline.getCurrentPhase() !== "availableSegmentPointSolver" &&
    !pipeline.failed
  ) {
    pipeline.step()
  }

  expect(pipeline.failed).toBe(false)
  expect(pipeline.topologyMergingSolver?.getOutput()).toHaveLength(34_084)
  expect(pipeline.edgeSolver?.nodes).toHaveLength(80_358)
  expect(pipeline.edgeSolver?.edges).toHaveLength(253_079)

  const edgeSolver = pipeline.edgeSolver!
  const targetNodeIds = new Set(
    edgeSolver.nodes
      .filter((node) => node._containsTarget)
      .slice(0, 200)
      .map((node) => node.capacityMeshNodeId),
  )
  expect(targetNodeIds.size).toBe(200)
  const targetEdges = edgeSolver.edges.filter(({ nodeIds }) =>
    nodeIds.some((nodeId) => targetNodeIds.has(nodeId)),
  )
  const displayedNodeIds = new Set(targetEdges.flatMap(({ nodeIds }) => nodeIds))
  const targetAccessVisualization = new CapacityMeshEdgeSolver(
    edgeSolver.nodes.filter((node) =>
      displayedNodeIds.has(node.capacityMeshNodeId),
    ),
  )
  targetAccessVisualization.edges = targetEdges

  const svg = getGraphicsSvgFrames({
    frames: [
      {
        name: "PMP22650 point-pair routing problem",
        step: 0,
        iteration: pipeline.netToPointPairsSolver!.iterations,
        graphics: pipeline.netToPointPairsSolver!.visualize(),
      },
      {
        name: "PMP22650 target access after topology finalization",
        step: 1,
        iteration: edgeSolver.iterations,
        graphics: targetAccessVisualization.visualize(),
      },
    ],
    columns: 2,
  })

  await expect(svg).toMatchSvgSnapshot(import.meta.path, { scale: 1 })
})
