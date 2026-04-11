import { expect, test } from "bun:test"
import * as dataset01 from "@tscircuit/autorouting-dataset-01"
import { AutoroutingPipelineSolver4 } from "lib/autorouter-pipelines/AutoroutingPipeline4_TinyHypergraph/AutoroutingPipelineSolver4_TinyHypergraph"
import { AutoroutingPipelineSolver5 } from "lib/autorouter-pipelines/AutoroutingPipeline5_HdCache/AutoroutingPipelineSolver5_HdCache"

const getCircuit011 = () =>
  (dataset01 as Record<string, unknown>).circuit011 as any

const getMaxNodeRatio = (
  nodes: Array<{ width: number; height: number }>,
): number => {
  return Math.max(
    ...nodes.map((node) => {
      const longSide = Math.max(node.width, node.height)
      const shortSide = Math.min(node.width, node.height)
      return longSide / shortSide
    }),
  )
}

test("pipeline4 defaults node subdivision to 16mm with max node ratio 6", () => {
  const pipeline = new AutoroutingPipelineSolver4(
    structuredClone(getCircuit011()),
  )

  pipeline.solveUntilPhase("edgeSolver")

  expect(pipeline.maxNodeDimension).toBe(16)
  expect(pipeline.maxNodeRatio).toBe(6)
  expect(pipeline.minNodeArea).toBe(0.1 ** 2)
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
  expect(getMaxNodeRatio(pipeline.capacityNodes ?? [])).toBeLessThanOrEqual(6)
  expect(
    (pipeline.capacityNodes ?? []).filter((node) =>
      node.capacityMeshNodeId.includes("__sub_"),
    ).length,
  ).toBeGreaterThan(0)
  expect(pipeline.nodeDimensionSubdivisionSolver?.stats.maxNodeDimension).toBe(
    16,
  )
  expect(pipeline.nodeDimensionSubdivisionSolver?.stats.maxNodeRatio).toBe(6)
  expect(pipeline.nodeDimensionSubdivisionSolver?.stats.minNodeArea).toBe(
    0.1 ** 2,
  )
})

test.skip("pipeline5 defaults node subdivision to 7mm with max node ratio 4", () => {
  const pipeline = new AutoroutingPipelineSolver5(
    structuredClone(getCircuit011()),
  )

  pipeline.solveUntilPhase("edgeSolver")

  expect(pipeline.maxNodeDimension).toBe(7)
  expect(pipeline.maxNodeRatio).toBe(4)
  expect(pipeline.capacityNodes).toBeDefined()
  expect(
    Math.max(
      ...(pipeline.capacityNodes ?? []).map((node) =>
        Math.max(node.width, node.height),
      ),
    ),
  ).toBeLessThanOrEqual(7)
  expect(getMaxNodeRatio(pipeline.capacityNodes ?? [])).toBeLessThanOrEqual(4)
  expect(pipeline.nodeDimensionSubdivisionSolver?.stats.maxNodeDimension).toBe(
    7,
  )
  expect(pipeline.nodeDimensionSubdivisionSolver?.stats.maxNodeRatio).toBe(4)
})
