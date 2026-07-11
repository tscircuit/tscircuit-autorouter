import { expect, test } from "bun:test"
import {
  type DistinctOwnerBlockerHop,
  findDistinctOwnerBlockerPath,
} from "lib/solvers/PortPointPathingSolver/tinyhypergraph/find-distinct-owner-blocker-path"

type State = "start" | "join" | "goal"
type Owner = "a" | "b" | "c" | "d" | "e"
type HopData = "slow_join" | "fast_join" | "join_goal" | "crowded_goal"
type Hop = DistinctOwnerBlockerHop<State, Owner, HopData>

test("distinct-owner search preserves Pareto labels and minimizes owners before distance", (): void => {
  const graph: Record<State, readonly Hop[]> = {
    start: [
      {
        state: "join",
        distance: 8,
        owners: ["a"],
        data: "slow_join",
      },
      {
        state: "join",
        distance: 1,
        owners: ["a", "b"],
        data: "fast_join",
      },
      {
        state: "goal",
        distance: 0.5,
        owners: ["c", "d", "e"],
        data: "crowded_goal",
      },
    ],
    join: [
      {
        state: "goal",
        distance: 1,
        owners: ["b"],
        data: "join_goal",
      },
    ],
    goal: [],
  }

  const result = findDistinctOwnerBlockerPath({
    start: "start" as State,
    getStateKey: (state: State): State => state,
    isGoal: (state: State): boolean => state === "goal",
    getHops: (state: State): Iterable<Hop> => graph[state],
  })

  expect(result.found).toBe(true)
  if (!result.found) throw new Error(`Search failed: ${result.reason}`)
  expect(result.states).toEqual(["start", "join", "goal"])
  expect(result.hops.map((hop): HopData | undefined => hop.data)).toEqual([
    "fast_join",
    "join_goal",
  ])
  expect([...result.owners].sort()).toEqual(["a", "b"])
  expect(result.distance).toBe(2)
})
