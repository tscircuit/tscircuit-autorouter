import { expect, test } from "bun:test"
import { findDistinctOwnerBlockerPath, type DistinctOwnerBlockerHop } from "tiny-hypergraph/lib/find-distinct-owner-blocker-path"
import { findFeasibleOwnerCorridor } from "../../lib/solvers/PortPointPathingSolver/tinyhypergraph/findFeasibleOwnerCorridor"

test("feasible corridor prices each owner once and explicitly changes the minimum-owner objective", (): void => {
  type Hop = DistinctOwnerBlockerHop<number, string, string>
  const graph: Hop[][] = [
    [{ state: 1, owners: ["fragile", "fragile"], distance: 1, data: "fragile-first" },
      { state: 2, owners: ["easy-b"], distance: 1, data: "easy-first" }],
    [{ state: 4, owners: ["fragile"], distance: 1, data: "fragile-repeat" }],
    [{ state: 3, owners: ["easy-a", "easy-b"], distance: 1, data: "easy-second" }],
    [{ state: 4, owners: ["easy-a"], distance: 1, data: "easy-repeat" }], [],
  ]
  const native = findDistinctOwnerBlockerPath({ start: 0, getStateKey: (state: number): number => state,
    isGoal: (state: number): boolean => state === 4, getHops: (state: number): Hop[] => graph[state]!, maxExpandedLabels: 100 })
  expect(native.found).toBe(true)
  if (!native.found) throw new Error("Expected independently known native path")
  expect([...native.owners]).toEqual(["fragile"])
  const answer = findFeasibleOwnerCorridor({ start: 0, getStateKey: (state: number): number => state,
    isGoal: (state: number): boolean => state === 4, getHops: (state: number): Hop[] => graph[state]!,
    getOwnerWork: (owner: string): number => owner === "fragile" ? 30 : 1,
    getGoalDistance: (): number => 0, distanceScale: 10, maxExpandedLabels: 100 })
  expect(answer.result.found).toBe(true)
  if (!answer.result.found) throw new Error("Expected weighted feasible path")
  expect(answer.result.states).toEqual([0, 2, 3, 4])
  expect(answer.result.hops).toEqual([graph[0]![1], graph[2]![0], graph[3]![0]])
  expect([...answer.result.owners]).toEqual(["easy-b", "easy-a"])
  expect(answer.result.distance).toBe(3)
  expect(answer.selectedOwnerWork).toBe(2)
  expect(answer.selectedScore).toBe(3.2)
  expect(answer.objectiveMinimumProven).toBe(false)
  expect(answer.chosenSetDistanceMinimumProven).toBe(true)
  expect(answer.work.generatedCandidates).toBe(1)
  expect(answer.work.refinementCalls).toBe(1)
})
