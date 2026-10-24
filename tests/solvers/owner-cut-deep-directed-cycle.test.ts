import { expect, test } from "bun:test"
import { buildOwnerCutCondensation } from "../../lib/solvers/PortPointPathingSolver/tinyhypergraph/buildOwnerCutCondensation"

test("deep zero-owner cycles condense without recursion but conditional return edges never merge", (): void => {
  const count = 12_000
  for (const conditional of [false, true]) {
    const condensed = buildOwnerCutCondensation({ start: 0, getStateKey: (state: number): number => state, isGoal: (state: number): boolean => state === count, getHops: (state: number) => state < count - 1 ? [{ state: state + 1, owners: [] as number[], distance: 1 }] : [{ state: 0, owners: conditional ? [7] : [], distance: 1 }, { state: count, owners: [8], distance: 1 }], getOwners: (hop) => hop.owners!, charge: (): boolean => true })
    if (!condensed) throw new Error("Unlimited finite graph must finish")
    expect(condensed.stateCount).toBe(count + 1)
    expect(condensed.adjacency.length).toBe(conditional ? count + 1 : 2)
    expect(condensed.goals.size).toBe(1)
    if (!conditional) expect(condensed.adjacency[condensed.start]).toEqual([{ to: [...condensed.goals][0]!, owners: [8] }])
  }
})
