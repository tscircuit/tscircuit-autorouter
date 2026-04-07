import { expect, test } from "bun:test"
import * as dataset01 from "@tscircuit/autorouting-dataset-01"
import { AutoroutingPipelineSolver4 } from "lib/autorouter-pipelines/AutoroutingPipeline4_TinyHypergraph/AutoroutingPipelineSolver4_TinyHypergraph"
import { AutoroutingPipelineSolver5 } from "lib/autorouter-pipelines/AutoroutingPipeline5_HdCache/AutoroutingPipelineSolver5_HdCache"

const getCircuit011 = () =>
  (dataset01 as Record<string, unknown>).circuit011 as any

test("pipeline4 defaults node subdivision to 16mm", () => {
  const pipeline = new AutoroutingPipelineSolver4(
    structuredClone(getCircuit011()),
  )

  pipeline.solveUntilPhase("edgeSolver")

  expect(pipeline.maxNodeDimension).toBe(16)
  expect(pipeline.capacityNodes).toBeDefined()
  expect(
    Math.max(
      ...(pipeline.capacityNodes ?? []).map((node) =>
        Math.max(node.width, node.height),
      ),
    ),
  ).toBeLessThanOrEqual(16)
  expect(
    Math.max(
      ...(pipeline.capacityNodes ?? []).map((node) =>
        Math.max(node.width, node.height),
      ),
    ),
  ).toBeGreaterThan(8)
  expect(
    (pipeline.capacityNodes ?? []).filter((node) =>
      node.capacityMeshNodeId.includes("__sub_"),
    ).length,
  ).toBe(2)
  expect(pipeline.nodeDimensionSubdivisionSolver?.stats.maxNodeDimension).toBe(
    16,
  )
})
