import * as repair04 from "@tscircuit/repair04"
import { expect, spyOn, test } from "bun:test"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { applyPipeline9ClearanceProjection } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9ClearanceProjection"
import { Pipeline9ClearanceProjectionSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9ClearanceProjectionSolver"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("clearance projection resumes one generator chunk per step and retains synchronous geometry", (): void => {
  const fixture = createBoundedRegionalRepairFixture()
  fixture.routes[0]!.route = [
    { x: -4, y: 0.28, z: 0, pcb_port_id: "start" },
    { x: 4, y: 0.28, z: 0, pcb_port_id: "end" },
  ]
  for (const point of fixture.originalSrj.connections[0]!.pointsToConnect) {
    point.y = 0.28
  }
  fixture.originalSrj.obstacles[0]!.center.y = 0.28
  fixture.originalSrj.obstacles[1]!.center.y = 0.28
  const original = structuredClone(fixture.routes)
  const originalSteps = repair04.relaxTraceClearanceSteps
  let generatorAdvances = 0
  let referenceChecks = 0
  const stepsSpy = spyOn(repair04, "relaxTraceClearanceSteps").mockImplementation(
    function* (input): ReturnType<typeof originalSteps> {
      const iterator = originalSteps(input)
      while (true) {
        generatorAdvances++
        const result = iterator.next()
        if (result.done) return result.value
        yield
      }
    },
  )
  const solver = new Pipeline9ClearanceProjectionSolver({
    ...fixture,
    subdivideSegments: true,
    usePrecisionMargin: true,
    drcEvaluator: (input): ReturnType<DrcEvaluator> => {
      referenceChecks++
      return fixture.drcEvaluator(input)
    },
  })
  try {
    expect(referenceChecks).toBe(0)
    expect(() => solver.getOutput()).toThrow("not complete")
    solver.step()
    expect(solver.solved).toBe(false)
    expect(referenceChecks).toBe(1)
    expect(generatorAdvances).toBe(0)
    while (!solver.solved && !solver.failed) {
      const advancesBefore = generatorAdvances
      const progressBefore = solver.progress
      solver.step()
      expect(generatorAdvances - advancesBefore).toBeLessThanOrEqual(1)
      expect(solver.progress).toBeGreaterThanOrEqual(progressBefore)
      expect(fixture.routes).toEqual(original)
    }
    expect(solver.failed).toBe(false)
    expect(generatorAdvances).toBeGreaterThan(10)
    expect(referenceChecks).toBe(2)
    expect(solver.iterations).toBeLessThanOrEqual(solver.MAX_ITERATIONS)
    expect(solver.progress).toBe(1)
  } finally {
    stepsSpy.mockRestore()
  }
  const routes = solver.getOutput()
  expect(routes).toEqual(
    applyPipeline9ClearanceProjection({
      ...fixture,
      subdivideSegments: true,
      usePrecisionMargin: true,
    }),
  )
  const reference = fixture.drcEvaluator({ traces: [], routes })
  expect(Array.isArray(reference) ? reference : reference.errors).toHaveLength(0)
  expect(routes[0]!.route[0]).toEqual(original[0]!.route[0])
  expect(routes[0]!.route.at(-1)).toEqual(original[0]!.route.at(-1))
})
