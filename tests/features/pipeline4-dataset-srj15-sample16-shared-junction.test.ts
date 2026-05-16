import { expect, test } from "bun:test"
import sample16 from "fixtures/datasets/dataset-srj15/sample16-region-reroute.srj.json" with {
  type: "json",
}
import { AutoroutingPipelineSolver4 } from "lib/autorouter-pipelines/AutoroutingPipeline4_TinyHypergraph/AutoroutingPipelineSolver4_TinyHypergraph"
import type { SimpleRouteJson } from "lib/types"

const sameRootPointKey = (portPoint: {
  connectionName: string
  rootConnectionName?: string
  x: number
  y: number
  z: number
}) =>
  [
    portPoint.rootConnectionName ?? portPoint.connectionName,
    portPoint.x.toFixed(6),
    portPoint.y.toFixed(6),
    portPoint.z ?? 0,
  ].join(":")

test("pipeline4 dataset-srj15 sample16 keeps shared junction memberships but solves cmn_5", () => {
  const solver = new AutoroutingPipelineSolver4(
    structuredClone(sample16 as SimpleRouteJson),
    { cacheProvider: null },
  )

  while (
    !solver.failed &&
    solver.getCurrentPhase() !== "uniformPortDistributionSolver"
  ) {
    solver.step()
  }

  expect(solver.failed).toBe(false)

  const cmn5BeforeHighDensity = solver.portPointPathingSolver
    ?.getOutput()
    .nodesWithPortPoints.find((node) => node.capacityMeshNodeId === "cmn_5")
  const sameRootPointKeys =
    cmn5BeforeHighDensity?.portPoints.map(sameRootPointKey) ?? []

  expect(cmn5BeforeHighDensity?.portPoints).toHaveLength(16)
  expect(new Set(sameRootPointKeys).size).toBeLessThan(sameRootPointKeys.length)

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(
    solver.highDensityRouteSolver?.nodeSolveMetadataById.get("cmn_5")?.status,
  ).toBe("solved")
}, 120_000)
