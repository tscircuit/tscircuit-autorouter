import { expect, test } from "bun:test"
import { AssignableViaAutoroutingPipelineSolver } from "lib/solvers/AssignableViaAutoroutingPipeline/AssignableViaAutoroutingPipelineSolver"
import type { SimpleRouteJson } from "lib/types"
import fixture from "../../examples/unassigned-obstacles/LoopedReassignmentZeroViaSolver/LoopedReassignmentZeroViaSolver02.json" assert {
  type: "json",
}

function makeViasAssignable(srj: SimpleRouteJson): SimpleRouteJson {
  return {
    ...srj,
    obstacles: srj.obstacles.map((obstacle) => ({
      ...obstacle,
      netIsAssignable:
        obstacle.connectedTo.length === 0 && obstacle.layers.length === 2,
    })),
  }
}

test("assignable via pipeline solves complex two-layer obstacle routing", () => {
  const srj = makeViasAssignable(fixture as SimpleRouteJson)
  const solver = new AssignableViaAutoroutingPipelineSolver(srj)

  const MAX_STEPS = 50_000
  for (let i = 0; i < MAX_STEPS; i++) {
    if (solver.initialPathingSolver?.solved || solver.failed) {
      break
    }
    solver.step()
  }

  expect(solver.failed).toBe(false)
  expect(solver.initialPathingHyperSolver?.solved).toBe(true)
  expect(solver.initialPathingSolver?.solved).toBe(true)
  expect(solver.initialPathingSolver?.solvedRoutes.length).toBeGreaterThan(0)
})
