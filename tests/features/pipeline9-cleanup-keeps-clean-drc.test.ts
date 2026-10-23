import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { Pipeline9EffortCleanupSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9EffortCleanupSolver"
import type { SimpleRouteJson } from "lib/types"
import srjJson from "../../fixtures/bug-reports/pipeline9-rotated-keepout/pipeline9-rotated-keepout.srj.json" with {
  type: "json",
}

test("cleanup cannot restore baseline errors after accepting a clean candidate", (): void => {
  const input = structuredClone(srjJson) as SimpleRouteJson
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })
  solver.solveUntilPhase("effortCleanupSolver")
  expect(solver.failed).toBe(false)
  const repaired = solver.pipeline9JointDrcRepairSolver!.getOutput()
  const broken = structuredClone(repaired)
  broken[0]!.route = [
    repaired[0]!.route[0]!,
    { x: 5, y: 4, z: 0 },
    repaired[0]!.route.at(-1)!,
  ]
  solver.pipeline9JointDrcRepairSolver!.getOutput = (): typeof broken => broken
  const step = solver.pipelineDef.find(
    (step) => step.solverName === "effortCleanupSolver",
  )!
  const [params] = step.getConstructorParams(
    solver,
  ) as ConstructorParameters<typeof Pipeline9EffortCleanupSolver>
  expect(params.isValid(broken)).toBe(true)
  expect(params.isValid(repaired)).toBe(true)
  expect(params.isValid(broken)).toBe(false)
})
