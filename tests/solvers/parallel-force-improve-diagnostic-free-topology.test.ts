import { expect, spyOn, test } from "bun:test"
import { HighDensityForceImproveSolver as OriginalSolver, runForceDirectedImprovement } from "high-density-repair01/lib/HighDensityForceImproveSolver"
import * as topology from "high-density-repair01/lib/utils/high-density-force-improve-topology"
import fixture from "high-density-repair01/tests/fixtures/bugreport94-force-input.json"
import { HighDensityForceImproveSolver as WorkerSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/force-improvement-fork/HighDensityForceImproveSolver"

type Params = ConstructorParameters<typeof OriginalSolver>[0]

test("diagnostic-free force improvement retains Bug 94 projection and topology guard branches", (): void => {
  const params = fixture as Params
  const originalInput = structuredClone(params)
  const node = params.nodeWithPortPoints[0]!
  const baseline = runForceDirectedImprovement({
    minX: node.center.x - node.width / 2, maxX: node.center.x + node.width / 2,
    minY: node.center.y - node.height / 2, maxY: node.center.y + node.height / 2,
  }, structuredClone(params.hdRoutes), params.totalStepsPerNode!, { includeForceVectors: false })
  expect(topology.findNewProperSegmentCrossings(params.hdRoutes, baseline.routes).length).toBeGreaterThan(0)
  const guard = spyOn(topology, "preconditionRoutesForNewCrossings")
  const alignment = spyOn(topology, "findAlignedTopologyCandidate")
  try {
    const original = new OriginalSolver(structuredClone(params))
    const worker = new WorkerSolver({ ...structuredClone(params), captureDiagnostics: false })
    original.solve()
    const originalGuardCount = guard.mock.calls.length
    const originalAlignmentCount = alignment.mock.calls.length
    expect(originalGuardCount).toBeGreaterThan(0)
    expect(originalAlignmentCount).toBeGreaterThan(0)
    worker.solve()
    expect(guard.mock.calls.length).toBe(originalGuardCount * 2)
    expect(alignment.mock.calls.length).toBe(originalAlignmentCount * 2)
    expect(worker.solved).toBe(true)
    expect(worker.failed).toBe(false)
    expect(worker.getOutput()).toEqual(original.getOutput())
    expect(worker.stats).toEqual(original.stats)
    expect(worker.iterations).toBe(original.iterations)
    expect(worker.MAX_ITERATIONS).toBe(original.MAX_ITERATIONS)
    expect(worker.progress).toBe(original.progress)
    expect(worker.error).toBe(original.error)
    expect(worker.sampleEntries).toEqual(original.sampleEntries)
    expect(worker.activeSampleIndex).toBe(original.activeSampleIndex)
    expect(worker.improvedRoutesByIndex).toEqual(original.improvedRoutesByIndex)
    expect(worker.latestVisualization).toEqual({})
    expect(original.latestVisualization.lines!.length).toBeGreaterThan(0)
    expect(topology.findNewProperSegmentCrossings(params.hdRoutes, worker.getOutput())).toEqual([])
    expect(worker.originalHdRoutes).toEqual(originalInput.hdRoutes)
    expect(params).toEqual(originalInput)
  } finally {
    guard.mockRestore()
    alignment.mockRestore()
  }
})
