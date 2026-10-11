import { expect, test } from "bun:test"
import { Pipeline9ParallelHighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9ParallelHighDensitySolver"
import { createFirstValidFrontierFixture } from "tests/fixtures/first-valid-frontier-fixture"
import { FirstValidFrontierControlledPool } from "tests/fixtures/first-valid-frontier-controlled-pool"

test("whole-node competitors target native difficult cells or three independent routes rather than trivial cells", (): void => {
  const { params, nodes } = createFirstValidFrontierFixture(6)
  const [trivial, difficult, structural, sameRoot, belowThreshold, degenerate] = nodes
  if (!trivial || !difficult || !structural || !sameRoot || !belowThreshold || !degenerate) throw new Error("Missing eligibility fixture")
  for (const node of [structural, sameRoot]) {
    node.portPoints.push(...node.portPoints.slice(0, 2).map((port) => ({ ...port,
      connectionName: `${node.capacityMeshNodeId}_third`, rootConnectionName: `${node.capacityMeshNodeId}_third`, y: 0 })))
  }
  for (const port of sameRoot.portPoints) port.rootConnectionName = "shared_root"
  degenerate.width = 0
  const pool = new FirstValidFrontierControlledPool({ workerCount: 4 })
  const solver = new Pipeline9ParallelHighDensitySolver({ ...params, workerPool: pool, highDensityPolicy: "first-valid",
    nodePfById: new Map([[difficult.capacityMeshNodeId, 0.051], [belowThreshold.capacityMeshNodeId, 0.05],
      [degenerate.capacityMeshNodeId, 1]]) })
  try {
    solver.step()
    const pairedIds = pool.tasks.filter(({ job }) => job.kind === "highDensityA13Node")
      .map(({ job }) => { if (job.kind !== "highDensityA13Node") throw new Error("Unexpected node job"); return job.nodeWithPortPoints.capacityMeshNodeId })
    expect(new Set(pairedIds)).toEqual(new Set([difficult.capacityMeshNodeId, structural.capacityMeshNodeId]))
    expect(pool.tasks.filter(({ job }) => job.kind === "highDensityNode")).toHaveLength(6)
    expect(solver.stats.firstValidNodeFrontierStats.pairedNodeCount).toBe(2)
  } finally { pool.dispose() }
})
