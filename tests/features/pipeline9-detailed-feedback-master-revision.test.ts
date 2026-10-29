import { expect, test } from "bun:test"
import { Pipeline9DetailedFeedbackSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9DetailedFeedbackSolver"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { createDetailedFeedbackFixture } from "../fixtures/detailed-feedback/createDetailedFeedbackFixture"

test("UNKNOWN from an actual bounded HD prefix revises a completed global assignment without banning its corridor", (): void => {
  const params = createDetailedFeedbackFixture()
  params.probeStepsPerNode = 3
  const before = JSON.stringify(params.initialPathingSolver.getOutput())
  const originalDistribution = JSON.stringify(params.initialDistributionSolver.getOutput())
  const solver = new Pipeline9DetailedFeedbackSolver(params)
  let nativeRegularIterations = 0
  while (!solver.solved && !solver.failed) {
    solver.step()
    if (solver.activeSubSolver instanceof Pipeline9HighDensitySolver)
      nativeRegularIterations = Math.max(nativeRegularIterations,
        solver.activeSubSolver.activeRegularSolver?.iterations ?? 0)
  }
  expect(nativeRegularIterations).toBeGreaterThan(0)
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  expect(solver.stats.unknownProbes).toBe(1)
  expect(solver.stats.physicalConflicts).toBe(0)
  expect(solver.stats.replansCompleted).toBe(1)
  expect(solver.stats.changedAssignments).toBe(6)
  expect(solver.stats.selectedReplan).toBe(true)
  expect(solver.stats.chargedWork).toBe(solver.stats.setupWork + solver.stats.probeWork + solver.stats.replanWork)
  expect(solver.stats.chargedWork).toBeLessThan(solver.stats.workBudget)
  expect(solver.workStats.nativeConstructorIterations).toBe(0)
  expect(solver.workStats.reusedPreparedTopology).toBe(true)
  expect(JSON.stringify(params.initialPathingSolver.getOutput())).toBe(before)
  expect(JSON.stringify(params.initialDistributionSolver.getOutput())).toBe(originalDistribution)
  expect(solver.selectedPathingSolver).not.toBe(params.initialPathingSolver)
  expect(solver.selectedPathingSolver.solved).toBe(true)
  expect(solver.selectedDistributionSolver.solved).toBe(true)
  const originalCenter = params.initialPathingSolver.getOutput().nodesWithPortPoints.find((node) => node.capacityMeshNodeId === "0:0")!
  const revisedCenter = solver.selectedPathingSolver.getOutput().nodesWithPortPoints.find((node) => node.capacityMeshNodeId === "0:0")!
  expect(originalCenter.portPoints).toHaveLength(4)
  // Priced regions remain usable. One net still uses the original corridor.
  expect(revisedCenter.portPoints).toHaveLength(2)
  expect(Object.keys(solver.stats)).toHaveLength(16)
})
