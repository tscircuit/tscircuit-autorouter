import assert from "node:assert/strict"
import { HighDensitySolver } from "../../../lib/solvers/HighDensitySolver/HighDensitySolver"
import { InMemoryCache } from "../../../lib/cache/InMemoryCache"
import type { NodeWithPortPoints } from "../../../lib/types/high-density-types"
import { importReference } from "./tsReference"
const { HighDensitySolver: Reference } = await importReference<{ HighDensitySolver: typeof HighDensitySolver }>("lib/solvers/HighDensitySolver/HighDensitySolver.ts")
function run(Solver: typeof HighDensitySolver): { checkpoints: unknown[]; routes: string; solved: boolean } {
  globalThis.TSCIRCUIT_AUTOROUTER_IN_MEMORY_CACHE = new InMemoryCache()
  const nodes: NodeWithPortPoints[] = [0, 5].map((x, index) => ({ capacityMeshNodeId: `parent-validator-${index}`, center: { x, y: 0 }, width: 4, height: 4, availableZ: [0, 1], portPoints: [
    { connectionName: "a", x: x - 2, y: 0, z: 0 }, { connectionName: "a", x: x + 2, y: 0, z: 0 },
  ] }))
  const originalNodes = nodes.slice()
  const checkpoints: unknown[] = []
  const children: NonNullable<HighDensitySolver["activeSubSolver"]>[] = []
  const solver = new Solver({ nodePortPoints: nodes, colorMap: { a: "red" }, useGrowShrinkHighDensityIntraNodeSolver: true,
    growShrinkSolutionValidator: (): boolean => {
      const active = solver.activeSubSolver!
      children.push(active)
      checkpoints.push(JSON.parse(JSON.stringify({ iterations: solver.iterations, solved: solver.solved, failed: solver.failed,
        routes: solver.routes, queue: solver.unsolvedNodePortPoints, metadata: Object.fromEntries(solver.nodeSolveMetadataById),
        stats: solver.stats, active: { name: active.getSolverName(), iterations: active.iterations, solved: active.solved, failed: active.failed, routes: active.solvedRoutes },
      })))
      assert.equal(solver.unsolvedNodePortPoints, nodes)
      for (const metadata of solver.nodeSolveMetadataById.values()) assert.ok(originalNodes.includes(metadata.node))
      return true
    },
  })
  solver.solve()
  assert.equal(checkpoints.length, 2)
  assert.equal((checkpoints[0] as { routes: unknown[] }).routes.length, 0)
  assert.ok((checkpoints[1] as { routes: unknown[] }).routes.length > 0, "Later validators see previously completed board routes")
  for (const child of children) for (const route of child.solvedRoutes) assert.ok(solver.routes.includes(route), "Board output shares retained successful child route objects")
  return { checkpoints, routes: JSON.stringify(solver.routes), solved: solver.solved }
}
assert.deepEqual(run(HighDensitySolver), run(Reference))
console.log("Parent validator snapshots match frozen TypeScript across two nodes, including prior routes and retained route aliases")
