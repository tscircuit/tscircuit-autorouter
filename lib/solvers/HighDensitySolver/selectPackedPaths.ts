import type { HighDensityRoute } from "lib/types/high-density-types"
import type { PathPackingGeometry } from "./pathPackingGeometry"

/** Joint finite-domain search. No route is committed until every task has a compatible path. */
export function* selectPackedPaths(
  banks: readonly (readonly HighDensityRoute[])[],
  geometry: PathPackingGeometry,
  maximumStates = 4096,
): Generator<void, HighDensityRoute[] | null> {
  if (!Number.isSafeInteger(maximumStates) || maximumStates < 1)
    throw new Error("Invalid path packing selection budget")
  if (banks.length === 0 || banks.some((bank) => bank.length === 0)) return null
  const selected = Array<number>(banks.length).fill(-1)
  const conflicts = new Map<string, boolean>()
  let states = 0
  function* compatible(left: number, a: number, right: number, b: number): Generator<void, boolean> {
    yield
    const key = left < right ? `${left}:${a}:${right}:${b}` : `${right}:${b}:${left}:${a}`
    let conflict = conflicts.get(key)
    if (conflict === undefined) {
      conflict = yield* geometry.conflict(banks[left]![a]!, banks[right]![b]!)
      conflicts.set(key, conflict)
    }
    return !conflict
  }
  function* search(depth: number): Generator<void, boolean> {
    yield
    if (states >= maximumStates) return false
    states++
    geometry.audit.selectionStates++
    if (depth === banks.length) return true
    let task = -1, domain: number[] = []
    for (let i = 0; i < banks.length; i++) {
      if (selected[i] !== -1) continue
      const choices: number[] = []
      for (let c = 0; c < banks[i]!.length; c++) {
        let valid = true
        for (let j = 0; j < banks.length; j++) {
          yield
          if (selected[j] !== -1 && !(yield* compatible(i, c, j, selected[j]!))) {
            valid = false
            break
          }
        }
        if (valid) choices.push(c)
      }
      if (choices.length === 0) return false
      if (task === -1 || choices.length < domain.length) {
        task = i
        domain = choices
      }
    }
    if (task < 0) throw new Error("Incomplete path packing assignment lost a task")
    for (const choice of domain) {
      selected[task] = choice
      if (yield* search(depth + 1)) return true
      selected[task] = -1
    }
    return false
  }
  if (!(yield* search(0))) return null
  return selected.map((candidate, task) => {
    if (candidate < 0) throw new Error("Path packing published an incomplete assignment")
    return banks[task]![candidate]!
  })
}
