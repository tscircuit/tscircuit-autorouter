import { expect, test } from "bun:test"
import { findDistinctOwnerBlockerPath, type DistinctOwnerBlockerHop } from "tiny-hypergraph/lib/find-distinct-owner-blocker-path"
import { findPackedDistinctOwnerBlockerPath } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/tiny-hypergraph-fork/findPackedDistinctOwnerBlockerPath"

type State = { id: number }
type Hop = DistinctOwnerBlockerHop<State, number, { index: number }>

test("packed blocker search preserves native validation errors and disconnected-precheck callbacks", (): void => {
  for (const checkReachability of [false, true]) {
    for (const distance of [-1, NaN, Infinity, Number.MAX_VALUE]) {
      const options = { start: { id: 0 }, ownerCount: 2, checkReachability,
        getStateKey: (state: State): number => state.id,
        isGoal: (state: State): boolean => state.id === 2,
        getHops: (state: State): Hop[] => state.id < 2 ? [{ state: { id: state.id + 1 }, distance, owners: [1] }] : [],
      }
      let expectedError = ""
      try { findDistinctOwnerBlockerPath(options) } catch (error) { expectedError = String(error) }
      expect(expectedError.length).toBeGreaterThan(0)
      expect(() => findPackedDistinctOwnerBlockerPath(options)).toThrow(expectedError.replace(/^Error: /, ""))
    }
    for (const maxExpandedLabels of [-1, .5, NaN, -Infinity]) {
      const options = { start: { id: 0 }, ownerCount: 0, checkReachability, maxExpandedLabels,
        getStateKey: (state: State): number => state.id,
        isGoal: (): boolean => true,
        getHops: (): Hop[] => [],
      }
      expect(() => findDistinctOwnerBlockerPath(options)).toThrow("maxExpandedLabels must be a non-negative integer")
      expect(() => findPackedDistinctOwnerBlockerPath(options)).toThrow("maxExpandedLabels must be a non-negative integer")
    }
  }
  for (const startIsGoal of [false, true]) {
    for (const checkReachability of [false, true]) {
      const callbacks: string[][] = [[], []]
      const optionsFor = (log: string[]): {
        start: State; ownerCount: number; checkReachability: boolean; maxExpandedLabels: number;
        getStateKey: (state: State) => number; isGoal: (state: State) => boolean; getHops: (state: State) => Hop[];
      } => ({ start: { id: 0 }, ownerCount: 33, checkReachability, maxExpandedLabels: 0,
        getStateKey: (state): number => { log.push(`key:${state.id}`); return state.id },
        isGoal: (state): boolean => { log.push(`goal:${state.id}`); return startIsGoal },
        getHops: (state): Hop[] => { log.push(`hops:${state.id}`); return [] },
      })
      const expected = findDistinctOwnerBlockerPath(optionsFor(callbacks[0]!))
      const actual = findPackedDistinctOwnerBlockerPath(optionsFor(callbacks[1]!))
      expect(actual).toEqual(expected)
      expect(callbacks[1]).toEqual(callbacks[0])
    }
  }
})
