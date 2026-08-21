import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver4 } from "lib/autorouter-pipelines/AutoroutingPipeline4_TinyHypergraph/AutoroutingPipelineSolver4_TinyHypergraph"
import { HighDensitySolver } from "lib/solvers/HighDensitySolver/HighDensitySolver"
import { makeCrossingSingleLayerNode, makeNode } from "./test-helpers"

test("Pipeline4 high-density stage opts into GrowShrinkHighDensityIntraNodeSolver", () => {
  const solver = new AutoroutingPipelineSolver4({
    layerCount: 2,
    minTraceWidth: 0.15,
    minViaPadDiameter: 0.3,
    bounds: { minX: 0, minY: 0, maxX: 2, maxY: 2 },
    obstacles: [],
    connections: [],
  } as any)

  const highDensityStep = solver.pipelineDef.find(
    (step) => step.solverName === "highDensityRouteSolver",
  )
  expect(highDensityStep).toBeDefined()
  const impossibleNode = makeCrossingSingleLayerNode()
  const ordinaryNode = { ...makeNode(), availableZ: [0] }
  const inputNodes = [impossibleNode, ordinaryNode]
  const pipelineState = {
    ...solver,
    uniformPortDistributionSolver: { getOutput: () => inputNodes } as any,
    portPointPathingSolver: {
      getOutput: () => ({
        nodesWithPortPoints: inputNodes,
        inputNodeWithPortPoints: [],
      }),
    } as any,
  } as any
  const [highDensityParams] =
    highDensityStep!.getConstructorParams(pipelineState)
  const routableNodes = (highDensityParams as any).nodePortPoints

  expect(
    (highDensityParams as any).useGrowShrinkHighDensityIntraNodeSolver,
  ).toBe(true)
  expect(
    routableNodes.find(
      (node: any) =>
        node.capacityMeshNodeId === impossibleNode.capacityMeshNodeId,
    )?.availableZ,
  ).toEqual([0, 1])
  expect(
    routableNodes.find(
      (node: any) => node.capacityMeshNodeId === ordinaryNode.capacityMeshNodeId,
    )?.availableZ,
  ).toEqual([0])
  expect(pipelineState.highDensityNodePortPoints).toEqual(routableNodes)
  expect(pipelineState.highDensityNodePortPoints).not.toBe(routableNodes)

  const highDensitySolver = new HighDensitySolver(highDensityParams as any)
  expect(
    highDensitySolver.growShrinkFallbackToInvalidGeometryOnFailure,
  ).toBe(false)
})
