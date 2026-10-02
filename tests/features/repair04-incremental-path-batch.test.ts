import { expect, test } from "bun:test"
import {
  findClearancePathSteps,
  type ClearancePathSearchStats,
} from "@tscircuit/repair04"
import { pathInput } from "../fixtures/repair04StepFixtures"

test("incremental A* returns control after at most 128 heap pops without restarting its search", (): void => {
  const srj = structuredClone(pathInput.srj)
  srj.obstacles[0]!.height = 20
  const stats: ClearancePathSearchStats = {
    nodesPopped: 0,
    completionReason: "no-path",
  }
  const steps = findClearancePathSteps({
    ...pathInput,
    srj,
    routes: [pathInput.routes[0]!],
    stats,
    maxNodes: 1000,
  })
  expect(stats.nodesPopped).toBe(0)
  let previousNodes = 0
  let result = steps.next()
  let searchingYields = 0
  while (!result.done) {
    expect(stats.nodesPopped - previousNodes).toBeLessThanOrEqual(128)
    expect(stats.nodesPopped).toBeGreaterThanOrEqual(previousNodes)
    if (stats.nodesPopped > previousNodes) searchingYields++
    previousNodes = stats.nodesPopped
    result = steps.next()
  }
  expect(stats.nodesPopped - previousNodes).toBeLessThanOrEqual(128)
  expect(searchingYields).toBeGreaterThan(1)
  expect(stats.nodesPopped).toBe(1000)
  expect(stats.completionReason).toBe("node-limit")
  expect(result.value).toBeNull()
})
