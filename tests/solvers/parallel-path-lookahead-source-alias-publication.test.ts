import { expect, test } from "bun:test"
import { MultiSimplifiedPathSolver } from "@tscircuit/trace-simplification-solver"
import { ParallelPathLookaheadCoordinator } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelPathLookaheadCoordinator"
import { ParallelPathLookaheadExecutor } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelPathLookaheadExecutor"
import { initializeReferenceDrcRuntime } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/initializeReferenceDrcRuntime"
import type { ParallelPathLookaheadResult } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelPathLookaheadTypes"
import type { HighDensityRoute } from "lib/types/high-density-types"

function makeNative(): MultiSimplifiedPathSolver {
  const routes: HighDensityRoute[] = []
  for (let index = 0; index < 12; index++) {
    const metadata = { value: index }
    const first = { x: -2, y: index * 0.8, z: 0, metadata }
    routes.push({ connectionName: `route-${index}`, traceThickness: 0.15, viaDiameter: 0.3, vias: [], jumpers: [],
      route: [first, { x: 0, y: first.y + 0.3, z: 0 }, { x: 2, y: first.y, z: 0 }] })
  }
  return new MultiSimplifiedPathSolver({ obstacles: [], unsimplifiedHdRoutes: routes })
}

test("certified publication preserves exact source point, nested metadata and empty jumper aliases across later withdrawal", async (): Promise<void> => {
  await initializeReferenceDrcRuntime()
  const expected = makeNative()
  while (expected.simplifiedHdRoutes.length < 4) expected.step()
  const expectedPoint = expected.unsimplifiedHdRoutes[1]!.route[0]! as typeof expected.unsimplifiedHdRoutes[number]["route"][number] & { metadata: { value: number } }
  expectedPoint.x -= 0.01
  expectedPoint.metadata.value = 77
  expected.solve()

  const original = makeNative()
  let eligible = true
  let changed = false
  const executors = Array.from({ length: 4 }, () => new ParallelPathLookaheadExecutor())
  const coordinator = new ParallelPathLookaheadCoordinator({ original, contextId: 721, workerCount: 4,
    isEligible: (): boolean => eligible,
    run: async (job): Promise<ParallelPathLookaheadResult> => {
      await Promise.resolve()
      const result = executors[job.index % 4]!.execute({ ...structuredClone({ ...job, cancellationBuffer: undefined }), cancellationBuffer: job.cancellationBuffer })
      if (job.index >= 4 && !changed) {
        changed = true
        expect(original.simplifiedHdRoutes.length).toBe(4)
        const source = original.unsimplifiedHdRoutes[1]!.route[0]! as typeof expectedPoint
        expect(original.simplifiedHdRoutes[1]!.route[0]).toBe(source)
        source.x -= 0.01
        source.metadata.value = 77
        eligible = false
      }
      return structuredClone(result)
    } })
  await coordinator.solve()
  expect(changed).toBe(true)
  expect(coordinator.native).toBe(original)
  expect(coordinator.stats.certifiedRoutes).toBe(4)
  expect(original.simplifiedHdRoutes).toEqual(expected.simplifiedHdRoutes)
  expect(original.iterations).toBe(expected.iterations)
  for (let index = 0; index < original.simplifiedHdRoutes.length; index++) {
    const route = original.simplifiedHdRoutes[index]!
    const input = original.unsimplifiedHdRoutes[index]!
    expect(route.route[0]).toBe(input.route[0])
    expect(route.jumpers).toBe(input.jumpers)
  }
})
