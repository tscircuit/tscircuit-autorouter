import { expect, test } from "bun:test"
import {
  findClearancePath,
  FindClearancePathSolver,
  negotiateTraceClearance,
  NegotiateTraceClearanceSolver,
  relaxTraceClearance,
  RelaxTraceClearanceSolver,
  type ClearancePathSearchStats,
} from "@tscircuit/repair04"
import {
  pathInput,
  negotiationInput,
  projectionInput,
} from "../fixtures/repair04StepFixtures"
import golden from "../fixtures/repair04-stepped-golden.json"

test("repair04 incremental APIs preserve the original synchronous geometry and work accounting", (): void => {
  const original = structuredClone({
    routes: negotiationInput.routes,
    projection: projectionInput.routes,
  })
  const pathStats: ClearancePathSearchStats = {
    nodesPopped: 0,
    completionReason: "no-path",
  }
  const path = new FindClearancePathSolver({ ...pathInput, stats: pathStats })
  expect(() => path.getOutput()).toThrow("before completion")
  while (!path.solved && !path.failed) path.step()
  expect(path.failed).toBeFalse()
  expect(path.getOutput()).toEqual(golden.path)
  expect(pathStats).toEqual(golden.pathStats)
  expect(path.iterations).toBeGreaterThan(1)
  expect(findClearancePath(pathInput)).toEqual(golden.path)

  const negotiation = new NegotiateTraceClearanceSolver(negotiationInput)
  expect(() => negotiation.getOutput()).toThrow("before completion")
  let visiblePathSteps = 0
  while (!negotiation.solved && !negotiation.failed) {
    const child = negotiation.activeSubSolver
    const previousIterations = child?.iterations
    negotiation.step()
    if (child) {
      expect(child.iterations).toBe(previousIterations! + 1)
      visiblePathSteps++
    }
  }
  expect(negotiation.failed).toBeFalse()
  expect(negotiation.getOutput()).toEqual(golden.negotiation)
  expect(visiblePathSteps).toBeGreaterThan(1)
  expect(negotiation.iterations).toBeGreaterThan(1)
  expect(negotiateTraceClearance(negotiationInput)).toEqual(golden.negotiation)

  const projection = new RelaxTraceClearanceSolver(projectionInput)
  expect(() => projection.getOutput()).toThrow()
  while (!projection.solved && !projection.failed) projection.step()
  expect(projection.failed).toBeFalse()
  expect(projection.getOutput()).toEqual(golden.projection)
  expect(projection.iterations).toBeGreaterThanOrEqual(256)
  expect(relaxTraceClearance(projectionInput)).toEqual(golden.projection)
  expect(negotiationInput.routes).toEqual(original.routes)
  expect(projectionInput.routes).toEqual(original.projection)
})
