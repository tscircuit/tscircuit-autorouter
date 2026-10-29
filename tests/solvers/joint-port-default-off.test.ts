import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { UniformPortDistributionSolver, type UniformPortDistributionSolverInput } from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import { createJointPortTestInput } from "./joint-port-test-input"

test("default pipeline options preserve uniform output while explicit activation records real work", (): void => {
  const input = createJointPortTestInput()
  const options = { nodeWithPortPoints: input.nodes, inputNodesWithPortPoints: input.inputNodes,
    obstacles: input.srj.obstacles, layerCount: 2 }
  const legacy = new UniformPortDistributionSolver(options)
  const enabled = new UniformPortDistributionSolver({ ...options,
    jointPortCoordinateOptimization: { srj: input.srj } })
  legacy.solve()
  enabled.solve()
  expect(legacy.solved).toBeTrue()
  expect(enabled.solved).toBeTrue()
  expect(legacy.getOutput()[0].portPoints.find((point) => point.portPointId === "shared-0")!.y).toBe(0)
  expect(legacy.stats.experimentJointPorts).toBeUndefined()
  const receipt = enabled.stats.experimentJointPorts as { active: boolean; movedPortCount: number }
  expect(receipt.active).toBeTrue()
  expect(receipt.movedPortCount).toBe(1)
  expect(enabled.getOutput()[0].portPoints.find((point) => point.portPointId === "shared-0")!.y).toBeCloseTo(1, 5)
  const defaultPipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input.srj, { cacheProvider: null })
  const explicitOff = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input.srj, {
    cacheProvider: null, experimentJointPorts: false })
  expect(defaultPipeline.opts.experimentJointPorts).toBeUndefined()
  expect(explicitOff.opts.experimentJointPorts).toBeFalse()
  for (const pipeline of [defaultPipeline, explicitOff]) {
    pipeline.portPointPathingSolver = { getOutput: () => ({ nodesWithPortPoints: input.nodes,
      inputNodeWithPortPoints: input.inputNodes }) } as typeof pipeline.portPointPathingSolver
    const definition = pipeline.pipelineDef.find((step) => step.solverName === "uniformPortDistributionSolver")!
    const stage = new UniformPortDistributionSolver(
      definition.getConstructorParams(pipeline)[0] as UniformPortDistributionSolverInput)
    stage.solve()
    expect(stage.getOutput()).toEqual(legacy.getOutput())
    expect(stage.stats).toEqual(legacy.stats)
  }
  const activePipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input.srj, {
    cacheProvider: null, experimentJointPorts: true })
  activePipeline.portPointPathingSolver = defaultPipeline.portPointPathingSolver
  const definition = activePipeline.pipelineDef.find((step) => step.solverName === "uniformPortDistributionSolver")!
  const stage = new UniformPortDistributionSolver(
    definition.getConstructorParams(activePipeline)[0] as UniformPortDistributionSolverInput)
  stage.solve()
  activePipeline.uniformPortDistributionSolver = stage
  definition.onSolved?.(activePipeline)
  expect(activePipeline.stats.experimentJointPorts).toEqual(stage.stats.experimentJointPorts)
  expect((activePipeline.stats.experimentJointPorts as { movedPortCount: number }).movedPortCount).toBe(1)
})
