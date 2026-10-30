import { expect, test } from "bun:test"
import { SolverRuntime } from "@tscircuit/solver-utils/runtime/bun"
import { Pipeline9ParallelRegionalTaskSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9ParallelRegionalTaskSolver"
import { planPipeline9ParallelRegionalTasks } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/planPipeline9ParallelRegionalTasks"
import { mergePipeline9ParallelRegionalResults } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/mergePipeline9ParallelRegionalResults"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("separate regions route concurrently within one shared budget and merge to a DRC-clean board", async (): Promise<void> => {
  const fixture = createBoundedRegionalRepairFixture(2)
  const srj = fixture.originalSrj
  srj.bounds.maxY = 50
  for (const obstacle of srj.obstacles.slice(3)) obstacle.center.y += 39
  for (const point of srj.connections[1]!.pointsToConnect) point.y += 39
  for (const point of fixture.routes[1]!.route) point.y += 39
  const initialReference = fixture.drcEvaluator({ traces: [], routes: fixture.routes })
  expect((Array.isArray(initialReference) ? initialReference : initialReference.errors).length).toBeGreaterThan(0)
  const errors = [
    { pcb_trace_id: "signal_0", center: { x: 0, y: 0 } },
    { pcb_trace_id: "signal_1", center: { x: 0, y: 40 } },
  ]
  const tasks = planPipeline9ParallelRegionalTasks({
    srj,
    routes: fixture.routes,
    errors,
    maxTasks: 4,
    maxPathSearchCalls: 20,
    maxPathSearchNodes: 200_000,
    maxPathSearchNodesPerCall: 100_000,
    maxLogicalIterations: 1_000_000,
    pathHeuristicWeight: 3,
    pathGridSizeScale: 2,
    searchDirectionCount: 2,
    viaHoleDiameter: 0.15,
  })
  expect(tasks).toHaveLength(2)
  expect(tasks.reduce((sum, task) => sum + task.maxPathSearchCalls, 0)).toBeLessThanOrEqual(20)
  expect(tasks.reduce((sum, task) => sum + task.maxPathSearchNodes, 0)).toBeLessThanOrEqual(200_000)
  const runtime = new SolverRuntime({
    workerCount: 2,
    workerUrl: new URL("../fixtures/pipeline9ParallelRegional.worker.ts", import.meta.url),
    requireWorker: true,
  })
  try {
    const results = await Promise.all(tasks.map((task) => runtime.executeAsync(Pipeline9ParallelRegionalTaskSolver, task)))
    expect(results.every((item) => item.result !== undefined)).toBe(true)
    expect(results.reduce((sum, item) => sum + item.pathSearchNodes, 0)).toBeLessThanOrEqual(200_000)
    const merged = mergePipeline9ParallelRegionalResults(fixture.routes, results)
    expect(merged.deferredCount).toBe(0)
    const conflicting = mergePipeline9ParallelRegionalResults(fixture.routes, [results[0]!, results[0]!])
    expect(conflicting.deferredCount).toBe(1)
    const reference = fixture.drcEvaluator({ traces: [], routes: merged.routes })
    expect(Array.isArray(reference) ? reference : reference.errors).toHaveLength(0)
  } finally {
    await runtime.dispose()
  }
})
