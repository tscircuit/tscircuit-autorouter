import { expect, test } from "bun:test"
import { HighDensityForceImproveSolver as OriginalSolver, runForceDirectedImprovement as originalImprovement } from "high-density-repair01/lib/HighDensityForceImproveSolver"
import fixture from "high-density-repair01/tests/fixtures/gameboy-force-improve-platform.json"
import { HighDensityForceImproveSolver as WorkerSolver, runForceDirectedImprovement as workerImprovement } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/force-improvement-fork/HighDensityForceImproveSolver"

type Params = ConstructorParameters<typeof OriginalSolver>[0]
type Solver = OriginalSolver | WorkerSolver

function observableState(solver: Solver): unknown {
  return {
    solved: solver.solved, failed: solver.failed, error: solver.error,
    iterations: solver.iterations, progress: solver.progress, maxIterations: solver.MAX_ITERATIONS,
    stats: solver.stats, samples: solver.sampleEntries, activeSampleIndex: solver.activeSampleIndex,
    improvedRoutes: solver.improvedRoutesByIndex, routes: solver.getOutput(),
    totalStepsPerNode: solver.totalStepsPerNode, nodeAssignmentMargin: solver.nodeAssignmentMargin,
  }
}

test("diagnostic-free force improvement preserves pinned Game Boy geometry, full state, and scalar force results", (): void => {
  const params = fixture as Params
  const originalInput = structuredClone(params)
  const original = new OriginalSolver(structuredClone(params))
  const worker = new WorkerSolver({ ...structuredClone(params), captureDiagnostics: false })
  const serialDefault = new WorkerSolver(structuredClone(params))
  expect(worker.captureDiagnostics).toBe(false)
  expect(serialDefault.captureDiagnostics).toBe(true)
  expect(serialDefault.getConstructorParams()).toEqual(original.getConstructorParams())
  expect(worker.getConstructorParams()[0]).toEqual({ ...original.getConstructorParams()[0], captureDiagnostics: false })
  while (!original.solved && !original.failed) {
    original.step()
    worker.step()
    serialDefault.step()
    expect(observableState(worker)).toEqual(observableState(original))
    expect(observableState(serialDefault)).toEqual(observableState(original))
    expect(worker.latestVisualization).toEqual({})
  }
  expect(original.solved).toBe(true)
  expect(original.failed).toBe(false)
  expect(original.stats.improvedRouteCount).toBe(params.hdRoutes.length)
  expect(original.getOutput()).not.toEqual(params.hdRoutes)
  expect(original.latestVisualization.lines!.length).toBeGreaterThan(0)
  expect(serialDefault.latestVisualization.lines!.length).toBeGreaterThan(0)
  expect(serialDefault.latestVisualization).toEqual(original.latestVisualization)
  expect(worker.visualize().lines!.length).toBeGreaterThan(0)
  expect(worker.latestVisualization).toEqual({})
  expect(original.originalHdRoutes).toEqual(originalInput.hdRoutes)
  expect(worker.originalHdRoutes).toEqual(originalInput.hdRoutes)
  expect(serialDefault.originalHdRoutes).toEqual(originalInput.hdRoutes)
  const node = params.nodeWithPortPoints[0]!
  const bounds = {
    minX: node.center.x - node.width / 2, maxX: node.center.x + node.width / 2,
    minY: node.center.y - node.height / 2, maxY: node.center.y + node.height / 2,
  }
  for (const steps of [0, 1, params.totalStepsPerNode!]) {
    const captured = originalImprovement(bounds, structuredClone(params.hdRoutes), steps, { includeForceVectors: true })
    const scalar = originalImprovement(bounds, structuredClone(params.hdRoutes), steps, { includeForceVectors: false })
    const forkScalar = workerImprovement(bounds, structuredClone(params.hdRoutes), steps, { includeForceVectors: false })
    expect(scalar.routes).toEqual(captured.routes)
    expect(forkScalar.routes).toEqual(captured.routes)
    expect(forkScalar.stepsCompleted).toBe(captured.stepsCompleted)
    expect(scalar.stepsCompleted).toBe(steps)
    expect(scalar.forceVectors).toEqual([])
    expect(forkScalar.forceVectors).toEqual([])
    if (steps > 0) expect(captured.forceVectors.length).toBeGreaterThan(0)
  }
  expect(params).toEqual(originalInput)
})
