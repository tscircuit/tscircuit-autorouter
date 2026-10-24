export type PriorityDagState<T> = { ancestors: Set<number>[]; witnesses: Array<T | undefined> }

/** Transitive closure represents priorities, not a claimed routing UNSAT proof.
 * Changing a priority invalidates every new descendant, even geometrically
 * distant tasks: both its copper scene and canonical future list change.
 */
export function extendPriorityDag<T>(state: PriorityDagState<T>, higher: number, lower: number,
  charge: (name: string, count?: number) => void): PriorityDagState<T> | null {
  charge("priorityBranchProposals")
  if (higher === lower || state.ancestors[higher].has(lower) || state.ancestors[lower].has(higher)) return null
  const ancestors = state.ancestors.map((set) => {
    charge("priorityClosureCopies", set.size + 1)
    return new Set(set)
  })
  const witnesses = state.witnesses.slice()
  charge("priorityWitnessSlotsCopied", witnesses.length)
  const additions = [...ancestors[higher], higher]
  for (let task = 0; task < ancestors.length; task++) {
    charge("priorityDescendantTests")
    if (task !== lower && !ancestors[task].has(lower)) continue
    for (const ancestor of additions) {
      charge("priorityClosureInsertions")
      ancestors[task].add(ancestor)
    }
    if (witnesses[task]) charge("priorityWitnessesInvalidated")
    witnesses[task] = undefined
  }
  return { ancestors, witnesses }
}
