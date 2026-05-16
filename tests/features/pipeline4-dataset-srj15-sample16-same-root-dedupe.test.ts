import { expect, test } from "bun:test"
import sample16 from "fixtures/datasets/dataset-srj15/sample16-region-reroute.srj.json" with {
  type: "json",
}
import { AutoroutingPipelineSolver4 } from "lib/autorouter-pipelines/AutoroutingPipeline4_TinyHypergraph/AutoroutingPipelineSolver4_TinyHypergraph"
import type { SimpleRouteJson } from "lib/types"
import { dedupeSameRootPortPoints } from "lib/utils/dedupeSameRootPortPoints"

test("dedupeSameRootPortPoints merges exact same-root ports in a node", () => {
  const [node] = dedupeSameRootPortPoints([
    {
      capacityMeshNodeId: "cmn_test",
      center: { x: 0, y: 0 },
      width: 1,
      height: 1,
      portPoints: [
        {
          connectionName: "source_net_1_branch_a",
          rootConnectionName: "source_net_1",
          x: 0,
          y: 0,
          z: 0,
        },
        {
          connectionName: "source_net_1_branch_b",
          rootConnectionName: "source_net_1",
          x: 0,
          y: 0,
          z: 0,
        },
        {
          connectionName: "source_net_2",
          rootConnectionName: "source_net_2",
          x: 0,
          y: 0,
          z: 0,
        },
      ],
    },
  ])

  expect(node!.portPoints).toHaveLength(2)
  expect(node!.portPoints.map((portPoint) => portPoint.connectionName)).toEqual(
    ["source_net_1_branch_a", "source_net_2"],
  )
})

test("pipeline4 dataset-srj15 sample16 completes after same-root dedupe", () => {
  const solver = new AutoroutingPipelineSolver4(
    structuredClone(sample16 as SimpleRouteJson),
    { cacheProvider: null },
  )

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(
    solver.highDensityRouteSolver?.nodeSolveMetadataById.get("cmn_5")?.status,
  ).toBe("solved")
}, 120_000)

test("pipeline4 dataset-srj15 sample16 removes same-root duplicates at port path output", () => {
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

  const cmn5 = solver.portPointPathingSolver
    ?.getOutput()
    .nodesWithPortPoints.find((node) => node.capacityMeshNodeId === "cmn_5")
  const sameRootPointKeys =
    cmn5?.portPoints.map((portPoint) =>
      [
        portPoint.rootConnectionName ?? portPoint.connectionName,
        portPoint.x.toFixed(6),
        portPoint.y.toFixed(6),
        portPoint.z ?? 0,
      ].join(":"),
    ) ?? []

  expect(cmn5?.portPoints).toHaveLength(15)
  expect(new Set(sameRootPointKeys).size).toBe(sameRootPointKeys.length)
}, 120_000)
