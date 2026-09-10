import type { SolverRecord } from "./reportTypes"

type SolverId = number

/** Infer IDs only for wrappers which Pipeline9 creates for one routing node. */
export function attributeNodeWrappers(solvers: SolverRecord[]): SolverRecord[] {
  const attributed = solvers.map((solver) => ({ ...solver }))
  const byId = new Map(attributed.map((solver) => [solver.id, solver]))
  const children = new Map<SolverId, SolverRecord[]>()
  for (const solver of attributed) {
    if (solver.parentId === null) continue
    const siblings = children.get(solver.parentId)
    if (siblings) siblings.push(solver)
    else children.set(solver.parentId, [solver])
  }
  for (const solver of attributed) {
    if (
      solver.nodeId ||
      !["HighDensitySolver", "Pipeline9RegionalFallbackSolver"].includes(
        solver.solver,
      )
    )
      continue
    const pending = [...(children.get(solver.id) ?? [])]
    const descendantNodeIds = new Set<string>()
    while (pending.length && descendantNodeIds.size < 2) {
      const descendant = pending.pop()!
      if (descendant.nodeId) descendantNodeIds.add(descendant.nodeId)
      pending.push(...(children.get(descendant.id) ?? []))
    }
    if (descendantNodeIds.size === 1) {
      solver.nodeId = [...descendantNodeIds][0]!
      solver.nodeAttribution = "single_node_wrapper_descendant"
    }
  }
  for (const solver of attributed) {
    if (solver.nodeId) continue
    let parentId = solver.parentId
    while (parentId !== null) {
      const parent = byId.get(parentId)
      if (!parent) throw new Error(`Unknown profile parent ${parentId}`)
      if (parent.nodeId) {
        solver.nodeId = parent.nodeId
        solver.nodeAttribution = "wrapper_ancestor"
        break
      }
      parentId = parent.parentId
    }
  }
  return attributed
}
