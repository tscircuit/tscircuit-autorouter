import { expect, test } from "bun:test"
import { findDistinctOwnerBlockerPath, type DistinctOwnerBlockerHop } from "tiny-hypergraph/lib/find-distinct-owner-blocker-path"
import { findPackedDistinctOwnerBlockerPath } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/tiny-hypergraph-fork/findPackedDistinctOwnerBlockerPath"

type State = { id: number }
type Hop = DistinctOwnerBlockerHop<State, number, { index: number }>

test("packed blocker arena preserves ordered results, exact callbacks, and growing predecessor storage", (): void => {
  let seed = 12345
  const random = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 0x1_0000_0000
  }
  for (let iteration = 0; iteration < 5000; iteration++) {
    const count = 2 + Math.floor(random() * 20)
    const ownerCount = iteration % 4 === 0 ? 0 : [1, 32, 33, 96, 257][iteration % 5]!
    const states = Array.from({ length: count }, (_, id) => ({ id }))
    const hops: Hop[][] = states.map(() => Array.from({ length: Math.floor(random() * 9) }, (_, index) => {
      const owners = Array.from({ length: ownerCount === 0 ? 0 : Math.floor(random() * 4) }, () => Math.floor(random() * ownerCount))
      if (owners.length > 0 && random() < .4) owners.push(owners[0]!)
      return { state: states[Math.floor(random() * count)]!, distance: [0, 1, 2, .1, Math.SQRT2][Math.floor(random() * 5)]!,
        ...(random() < .1 ? {} : { owners }), data: { index } }
    }))
    const config = { start: states[0]!, ownerCount,
      maxExpandedLabels: iteration % 7 === 0 ? 0 : 16 + Math.floor(random() * 200),
      checkReachability: iteration % 2 === 0 }
    const referenceCallbacks: string[] = []
    const actualCallbacks: string[] = []
    const optionsFor = (callbacks: string[]): typeof config & {
      getStateKey: (state: State) => number; isGoal: (state: State) => boolean; getHops: (state: State) => Hop[]
    } => ({ ...config,
      getStateKey: (state): number => { callbacks.push(`key:${state.id}`); return state.id % 2 === 0 ? state.id : -state.id },
      isGoal: (state): boolean => { callbacks.push(`goal:${state.id}`); return state.id === count - 1 },
      getHops: (state): Hop[] => { callbacks.push(`hops:${state.id}`); return hops[state.id]! },
    })
    const expected = findDistinctOwnerBlockerPath(optionsFor(referenceCallbacks))
    const actual = findPackedDistinctOwnerBlockerPath(optionsFor(actualCallbacks))
    expect(actual).toEqual(expected)
    expect(actualCallbacks).toEqual(referenceCallbacks)
    if (actual.found && expected.found) {
      expect([...actual.owners]).toEqual([...expected.owners])
      for (let index = 0; index < actual.hops.length; index++) expect(actual.hops[index]).toBe(expected.hops[index])
      for (let index = 0; index < actual.states.length; index++) expect(actual.states[index]).toBe(expected.states[index])
    }
  }
  const largeStates = Array.from({ length: 5001 }, (_, id) => ({ id }))
  const largeHops: Hop[][] = largeStates.map((state) => state.id === 5000 ? [] : [{
    state: largeStates[state.id + 1]!, distance: .1, owners: [[0, 31, 2048][state.id % 3]!], data: { index: state.id },
  }])
  const largeOptions = { start: largeStates[0]!, ownerCount: 2049, checkReachability: true,
    maxExpandedLabels: 5001, getStateKey: (state: State): number => state.id,
    isGoal: (state: State): boolean => state.id === 5000,
    getHops: (state: State): Hop[] => largeHops[state.id]!,
  }
  const expected = findDistinctOwnerBlockerPath(largeOptions)
  const actual = findPackedDistinctOwnerBlockerPath(largeOptions)
  expect(actual).toEqual(expected)
  expect(actual.found).toBe(true)
  if (actual.found && expected.found) {
    expect([...actual.owners]).toEqual([0, 31, 2048])
    expect(actual.states).toHaveLength(5001)
    expect(actual.hops[4999]).toBe(expected.hops[4999])
  }
})
