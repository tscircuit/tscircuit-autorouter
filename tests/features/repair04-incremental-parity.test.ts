import { expect, test } from "bun:test"
import {
  findClearancePath,
  findClearancePathSteps,
  negotiateTraceClearance,
  negotiateTraceClearanceSteps,
  relaxTraceClearance,
  relaxTraceClearanceSteps,
  type ClearancePathSearchStats,
} from "@tscircuit/repair04"
import {
  pathInput,
  negotiationInput,
  projectionInput,
} from "../fixtures/repair04StepFixtures"
import golden from "../fixtures/repair04-stepped-golden.json"

const drain = <T>(
  steps: Generator<void, T, void>,
): { output: T; yields: number } => {
  let result = steps.next()
  let yields = 0
  while (!result.done) {
    yields++
    result = steps.next()
  }
  return { output: result.value, yields }
}

test("repair04 incremental APIs preserve the original synchronous geometry and work accounting", (): void => {
  const original = structuredClone({
    routes: negotiationInput.routes,
    projection: projectionInput.routes,
  })
  const pathStats: ClearancePathSearchStats = {
    nodesPopped: 0,
    completionReason: "no-path",
  }
  const path = drain(findClearancePathSteps({ ...pathInput, stats: pathStats }))
  expect(path.output).toEqual(golden.path)
  expect(pathStats).toEqual(golden.pathStats)
  expect(path.yields).toBeGreaterThan(1)
  expect(findClearancePath(pathInput)).toEqual(golden.path)

  const negotiation = drain(negotiateTraceClearanceSteps(negotiationInput))
  expect(negotiation.output).toEqual(golden.negotiation)
  expect(negotiation.yields).toBeGreaterThan(1)
  expect(negotiateTraceClearance(negotiationInput)).toEqual(golden.negotiation)

  const projection = drain(relaxTraceClearanceSteps(projectionInput))
  expect(projection.output).toEqual(golden.projection)
  expect(projection.yields).toBeGreaterThanOrEqual(256)
  expect(relaxTraceClearance(projectionInput)).toEqual(golden.projection)
  expect(negotiationInput.routes).toEqual(original.routes)
  expect(projectionInput.routes).toEqual(original.projection)
})
