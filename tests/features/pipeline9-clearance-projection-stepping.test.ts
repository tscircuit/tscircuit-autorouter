import { RelaxTraceClearanceSolver } from "@tscircuit/repair04"
import { expect, spyOn, test } from "bun:test"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { Pipeline9ClearanceProjectionSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9ClearanceProjectionSolver"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("clearance projection advances its relaxation child once per step and preserves geometry", (): void => {
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
  const originalStep = RelaxTraceClearanceSolver.prototype.step
  let childSteps = 0
  let referenceChecks = 0
  const stepsSpy = spyOn(
    RelaxTraceClearanceSolver.prototype,
    "step",
  ).mockImplementation(function (this: RelaxTraceClearanceSolver): void {
    childSteps++
    originalStep.call(this)
  })
  const solveSpy = spyOn(
    RelaxTraceClearanceSolver.prototype,
    "solve",
  ).mockImplementation((): never => {
    throw new Error("Projection must advance the child with step")
  })
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
    expect(childSteps).toBe(0)
    expect(solver.activeSubSolver).toBeInstanceOf(RelaxTraceClearanceSolver)
    while (!solver.solved && !solver.failed) {
      const stepsBefore = childSteps
      const progressBefore = solver.progress
      solver.step()
      expect(childSteps - stepsBefore).toBeLessThanOrEqual(1)
      expect(solver.progress).toBeGreaterThanOrEqual(progressBefore)
      expect(fixture.routes).toEqual(original)
    }
    expect(solver.failed).toBe(false)
    expect(childSteps).toBeGreaterThan(10)
    expect(referenceChecks).toBe(2)
    expect(solver.iterations).toBeLessThanOrEqual(solver.MAX_ITERATIONS)
    expect(solver.progress).toBe(1)
    expect(solver.activeSubSolver).toBeNull()
    expect(solveSpy).not.toHaveBeenCalled()
  } finally {
    stepsSpy.mockRestore()
    solveSpy.mockRestore()
  }
  const routes = solver.getOutput()
  const repeatedSolver = new Pipeline9ClearanceProjectionSolver({
    ...fixture,
    subdivideSegments: true,
    usePrecisionMargin: true,
  })
  repeatedSolver.solve()
  expect(routes).toEqual(repeatedSolver.getOutput())
  const reference = fixture.drcEvaluator({ traces: [], routes })
  expect(Array.isArray(reference) ? reference : reference.errors).toHaveLength(
    0,
  )
  expect(routes[0]!.route[0]).toEqual(original[0]!.route[0])
  expect(routes[0]!.route.at(-1)).toEqual(original[0]!.route.at(-1))
})
