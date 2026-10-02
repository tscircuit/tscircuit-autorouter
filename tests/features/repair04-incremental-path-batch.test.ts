import { expect, test } from "bun:test"
import {
  FindClearancePathSolver,
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
  const solver = new FindClearancePathSolver({
    ...pathInput,
    srj,
    routes: [pathInput.routes[0]!],
    stats,
    maxNodes: 1000,
  })
  expect(stats.nodesPopped).toBe(0)
  let previousNodes = 0
  let searchingSteps = 0
  while (!solver.solved && !solver.failed) {
    solver.step()
    expect(stats.nodesPopped - previousNodes).toBeLessThanOrEqual(128)
    expect(stats.nodesPopped).toBeGreaterThanOrEqual(previousNodes)
    if (stats.nodesPopped > previousNodes) searchingSteps++
    previousNodes = stats.nodesPopped
  }
  expect(solver.failed).toBeFalse()
  expect(stats.nodesPopped - previousNodes).toBeLessThanOrEqual(128)
  expect(searchingSteps).toBeGreaterThan(1)
  expect(stats.nodesPopped).toBe(1000)
  expect(stats.completionReason).toBe("node-limit")
  expect(solver.getOutput()).toBeNull()
})
