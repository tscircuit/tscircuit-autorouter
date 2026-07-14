import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { loadScenarioBySampleNumber } from "scripts/benchmark/scenarios"

test("pipeline7 subdivides srj18 sample002's overloaded open-region topology node", async () => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 2, 0.1)
  const pipeline = new AutoroutingPipelineSolver7_MultiGraph(scenario, {
    effort: 0.1,
  })

  pipeline.solveUntilPhase("edgeSolver")

  const openRegionChildren = (pipeline.capacityNodes ?? []).filter((node) =>
    node.capacityMeshNodeId.startsWith("cmn_1__sub_"),
  )

  expect(pipeline.maxNodeDimension).toBe(10)
  expect(openRegionChildren).toHaveLength(4)
  expect(
    Math.max(
      ...openRegionChildren.map((node) => Math.max(node.width, node.height)),
    ),
  ).toBeLessThanOrEqual(10)
})
