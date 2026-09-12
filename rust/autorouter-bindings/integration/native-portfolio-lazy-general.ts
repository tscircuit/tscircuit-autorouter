import assert from "node:assert/strict"
import { InMemoryCache } from "../../../lib/cache/InMemoryCache"
import { IntraNodeRouteSolver } from "../../../lib/solvers/HighDensitySolver/IntraNodeSolver"
import { PortfolioSingleIntraNodeSolver } from "../../../lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"

const cacheProvider = new InMemoryCache()
const props = {
  cacheProvider,
  nodeWithPortPoints: {
    capacityMeshNodeId: "lazy-general", center: { x: 0, y: 0 }, width: 6, height: 6, availableZ: [0, 1],
    portPoints: [
      { connectionName: "a", x: -2.5, y: -2.5, z: 0 },
      { connectionName: "a", x: 2.5, y: 2.5, z: 0 },
      { connectionName: "b", x: -2.5, y: 2.5, z: 0 },
      { connectionName: "b", x: 2.5, y: -2.5, z: 0 },
    ],
  },
}
let attachments = 0
const attached = new Set<IntraNodeRouteSolver>()
const originalShare = IntraNodeRouteSolver.prototype.shareForPortfolio
IntraNodeRouteSolver.prototype.shareForPortfolio = function (): number {
  attachments++
  attached.add(this)
  return originalShare.call(this)
}
try {
  const cold = new PortfolioSingleIntraNodeSolver(props)
  cold.initializeSolvers()
  assert.equal(attachments, 0, "Initializing the candidate portfolio must not attach General engines")
  cold.solve()
  assert.equal(cold.solved, true)
  assert.ok(attachments > 0, "Cold General cache misses must attach their engines")
  const coldAttachments = attachments
  const warm = new PortfolioSingleIntraNodeSolver(props)
  warm.initializeSolvers()
  assert.equal(attachments, coldAttachments)
  warm.solve()
  assert.equal(warm.solved, true)
  const hits = warm.supervisedSolvers!.filter(({ solver }) => solver.cacheHit)
  assert.ok(hits.length > 0, "Warm replay must exercise a General cache hit")
  for (const { solver } of hits) assert.equal(attached.has(solver as IntraNodeRouteSolver), false, "Cache hits must not attach a General engine")
  assert.equal(JSON.stringify(warm.solvedRoutes), JSON.stringify(cold.solvedRoutes))
  console.log(`General attachment: ${coldAttachments} cold misses, ${attachments - coldAttachments} warm misses; zero for initialization or ${hits.length} cache hits`)
} finally {
  IntraNodeRouteSolver.prototype.shareForPortfolio = originalShare
}
