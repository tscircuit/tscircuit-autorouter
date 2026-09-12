import assert from "node:assert/strict"
import { HighDensitySolver } from "../../../lib/solvers/HighDensitySolver/HighDensitySolver"
import { CachedIntraNodeRouteSolver } from "../../../lib/solvers/HighDensitySolver/CachedIntraNodeRouteSolver"
import { InMemoryCache } from "../../../lib/cache/InMemoryCache"
import type { NodeWithPortPoints } from "../../../lib/types/high-density-types"
import { importReference } from "./tsReference"

const { HighDensitySolver: ReferenceBoard } = await importReference<{ HighDensitySolver: typeof HighDensitySolver }>("lib/solvers/HighDensitySolver/HighDensitySolver.ts")
const { CachedIntraNodeRouteSolver: ReferenceChild } = await importReference<{ CachedIntraNodeRouteSolver: typeof CachedIntraNodeRouteSolver }>("lib/solvers/HighDensitySolver/CachedIntraNodeRouteSolver.ts")

function run(Board: typeof HighDensitySolver, Child: typeof CachedIntraNodeRouteSolver): unknown[] {
  const cache = new InMemoryCache()
  globalThis.TSCIRCUIT_AUTOROUTER_IN_MEMORY_CACHE = cache
  const results: unknown[] = []
  for (const warm of [false, true]) {
    const node: NodeWithPortPoints = { capacityMeshNodeId: "assigned-cached", center: { x: 0, y: 0 }, width: 2, height: 2,
      availableZ: [0, 1], portPoints: [
        { connectionName: "a", x: -1, y: 0, z: 0 }, { connectionName: "a", x: 1, y: 0, z: 0 },
      ] }
    const board = new Board({ nodePortPoints: [], nodePfById: { "assigned-cached": 0.2 } })
    const child = new Child({ nodeWithPortPoints: node, cacheProvider: cache })
    board.activeSubSolver = child
    const checkpoints: unknown[] = []
    while (!board.solved && !board.failed) {
      assert.ok(board.iterations < 5000, "Assigned Cached exceeded fixture budget")
      board.step()
      checkpoints.push(JSON.parse(JSON.stringify({ iterations: board.iterations, solved: board.solved, failed: board.failed,
        error: board.error, stats: board.stats, metadata: Object.fromEntries(board.nodeSolveMetadataById), routes: board.routes,
        cacheHit: child.cacheHit, cacheHits: cache.cacheHits, cacheMisses: cache.cacheMisses,
      })))
    }
    assert.equal(child.cacheHit, warm)
    const metadata = board.nodeSolveMetadataById.get(node.capacityMeshNodeId)!
    assert.equal(metadata.solverType, `SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost${warm ? " [cached]" : ""}`)
    results.push(checkpoints)
  }
  return results
}

assert.deepEqual(run(HighDensitySolver, CachedIntraNodeRouteSolver), run(ReferenceBoard, ReferenceChild))
console.log("Assigned Cached cold/warm parity: exact per-step cache counts, resolved metadata/stats and routes")
