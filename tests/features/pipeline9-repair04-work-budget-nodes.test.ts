import { expect, test } from "bun:test"
import { Pipeline9Repair04Solver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9Repair04Solver"
import { createPipeline9Repair04Fixture } from "../fixtures/pipeline9-repair04-fixture"

type ObservedChild = {
  getConstructorParams(): [{ maxPathSearchNodes?: number }]
  stats: Record<string, number>
}

test("rejected regions retain the cumulative node charge and receive the smaller remaining cap", (): void => {
  const fixture = createPipeline9Repair04Fixture()
  let referenceCalls = 0
  const solver = new Pipeline9Repair04Solver({
    ...fixture,
    enabled: true,
    maxRegions: 5,
    maxPathSearchNodesPerRegion: 2,
    maxPathSearchNodesSinceAcceptance: 3,
    referenceDrcEvaluator: (): ReturnType<
      typeof fixture.referenceDrcEvaluator
    > => {
      referenceCalls++
      // Every changed full-board proposal is worse, so local progress cannot
      // replenish the node allowance used by the next context size.
      return Array.from({ length: referenceCalls }, () => ({
        type: "unretained_reference_constraint",
        center: { x: 0, y: 0 },
      }))
    },
  })
  const children: ObservedChild[] = []
  while (!solver.solved && !solver.failed) {
    solver.step()
    const child = (solver as unknown as { localSolver: ObservedChild | null })
      .localSolver
    if (child && children.at(-1) !== child) children.push(child)
  }
  expect(solver.failed).toBe(false)
  expect(
    children.map((child) => child.getConstructorParams()[0].maxPathSearchNodes),
  ).toEqual([2, 1])
  expect(children.map((child) => child.stats.pathSearchNodes)).toEqual([2, 1])
  expect(solver.stats.pathSearchNodes).toBe(3)
  expect(solver.stats.nodesSinceAcceptance).toBe(3)
  expect(solver.stats.acceptedRegions).toBe(0)
  expect(solver.stats.regions).toBe(2)
  expect(solver.stats.completionReason).toBe("unsuccessful-work-budget")
  expect(solver.getOutput()).toBe(fixture.hdRoutes)
})
