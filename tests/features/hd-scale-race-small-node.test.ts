import { expect, test } from "bun:test"
import { createRaceHarness, raceNode } from "../fixtures/hdFamilyRace"

test("a clearance deficit enables bounded scale search even for a two-connection node", (): void => {
  const node = structuredClone(raceNode)
  node.portPoints = node.portPoints.slice(0, 4)
  const { solver, created, portfolios } = createRaceHarness({
    params: { nodeWithPortPoints: node },
    plans: {
      1: { completeAfter: Infinity, budget: 2 },
      2: { completeAfter: 3, budget: 5 },
      4: { completeAfter: 1, budget: 5 },
    },
  })
  while (!solver.solved && !solver.failed && solver.iterations < 30) {
    solver.step()
  }
  expect(created).toEqual([1, 2, 4])
  expect(solver.solved).toBe(true)
  expect(solver.scaleFactor).toBe(2)
  expect(solver.solvedRoutes).toHaveLength(2)
  expect([...portfolios.values()].map((p) => p.other.iterations)).toEqual([
    0, 0, 0,
  ])
  expect(portfolios.get(2)!.getPreferredFamilyState().won).toBe(true)
})
