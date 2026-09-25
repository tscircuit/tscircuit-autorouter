import { expect, test } from "bun:test"
import * as dataset01 from "@tscircuit/autorouting-dataset-01"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import type { SimpleRouteJson } from "lib/types"

test("pipeline7 keeps global gap-fill nodes inside the board bounds", (): void => {
  const circuit003 = (dataset01 as Record<string, unknown>)
    .circuit003 as SimpleRouteJson
  const solver = new AutoroutingPipelineSolver7_MultiGraph(
    structuredClone(circuit003),
    { effort: 0.1, cacheProvider: null },
  )
  solver.solveUntilPhase("nodeDimensionSubdivisionSolver")

  expect(solver.failed).toBe(false)
  expect(solver.globalTopologyGeneratorSolver?.solved).toBe(true)
  const gapFillNodes = solver.globalTopologyGeneratorSolver!
    .getOutput()
    .meshNodes.filter((node) => node.capacityMeshNodeId.startsWith("new-"))
  expect(gapFillNodes.length).toBeGreaterThan(0)
  const { minX, maxX, minY, maxY } = circuit003.bounds
  const epsilon = 1e-8
  for (const node of gapFillNodes) {
    expect(node.center.x - node.width / 2).toBeGreaterThanOrEqual(minX - epsilon)
    expect(node.center.x + node.width / 2).toBeLessThanOrEqual(maxX + epsilon)
    expect(node.center.y - node.height / 2).toBeGreaterThanOrEqual(minY - epsilon)
    expect(node.center.y + node.height / 2).toBeLessThanOrEqual(maxY + epsilon)
  }
})
