import { expect, test } from "bun:test"
import { MultiHeadPolyLineIntraNodeSolver3 } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver3_ViaPossibilitiesSolverIntegration"
import { getMultiHeadPortPairs } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/getMultiHeadPortPairs"
import type {
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"

test("MultiHead retains both explicit Net299 events and their original endpoint identities", () => {
  const connectionName = "source_net_altium_pcb_299"
  const points: PortPoint[] = [
    {
      x: 275.3851998,
      y: 67.5727764975,
      portPointId: "ce237191_pp3_z7::7",
      nextPortPointId: "ce237199_pp0_z7::7",
    },
    {
      x: 275.3851998,
      y: 68.39433870875,
      portPointId: "ce237199_pp0_z7::7",
      prevPortPointId: "ce237191_pp3_z7::7",
    },
    {
      x: 275.3851998,
      y: 68.89371351625,
      portPointId: "ce237199_pp1_z7::7",
      nextPortPointId: "ce237448_pp5_z7::7",
    },
    {
      x: 275.96065711999995,
      y: 67.86116864,
      portPointId: "ce237448_pp5_z7::7",
      prevPortPointId: "ce237199_pp1_z7::7",
    },
  ].map((point) => ({
    ...point,
    z: 7,
    connectionName,
    rootConnectionName: connectionName,
  }))
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "topology_merge_60781__sub_2_0",
    center: { x: 275.67292846, y: 68.18906945000002 },
    width: 0.5754573199999413,
    height: 3.220266180000003,
    availableZ: [0, 1, 2, 3, 4, 5, 6, 7],
    portPoints: points,
    portPointsInPairs: [
      [points[0]!, points[1]!],
      [points[2]!, points[3]!],
    ],
  }
  const expectedPairs = node.portPointsInPairs!.map((pair) =>
    pair.map((p) => p.portPointId),
  )
  for (const explicit of [true, false]) {
    const input = structuredClone(node)
    if (!explicit) input.portPointsInPairs = []
    const solver = new MultiHeadPolyLineIntraNodeSolver3({
      nodeWithPortPoints: input,
      hyperParameters: { BOUNDARY_PADDING: -0.05 },
    })
    expect(solver.uniqueConnections).toBe(2)
    const seed = solver.createInitialCandidateFromSeed(0)!
    expect(seed.polyLines).toHaveLength(2)
    expect(seed.polyLines.map((line) => line.connectionName)).toEqual([
      connectionName,
      connectionName,
    ])
    expect(
      seed.polyLines
        .map((line) => [
          (line.start as typeof line.start & Pick<PortPoint, "portPointId">)
            .portPointId,
          (line.end as typeof line.end & Pick<PortPoint, "portPointId">)
            .portPointId,
        ])
        .sort(),
    ).toEqual([...expectedPairs].sort())
    expect(new Set(seed.polyLines.map((line) => line.portPairId)).size).toBe(2)
    solver.solve()
    expect(solver.solved).toBe(true)
    expect(solver.solvedRoutes).toHaveLength(2)
    for (const pair of node.portPointsInPairs!) {
      expect(
        solver.solvedRoutes.some((route) => {
          const [start, end] = [route.route[0]!, route.route.at(-1)!]
          return (
            start.x === pair[0].x &&
            start.y === pair[0].y &&
            start.z === pair[0].z &&
            end.x === pair[1].x &&
            end.y === pair[1].y &&
            end.z === pair[1].z
          )
        }),
      ).toBe(true)
    }
  }

  const coincident = [0, 7, 0, 7].map((z, index) => ({
    x: 0,
    y: 0,
    z,
    connectionName: "stacked",
    portPointId: `stacked-${index}`,
  }))
  const stacked: NodeWithPortPoints = {
    ...node,
    portPoints: coincident,
    portPointsInPairs: [
      [coincident[0]!, coincident[1]!],
      [coincident[2]!, coincident[3]!],
    ],
  }
  expect(
    [...getMultiHeadPortPairs(stacked).values()].map(({ start, end }) => [
      start.portPointId,
      end.portPointId,
    ]),
  ).toEqual([
    ["stacked-0", "stacked-1"],
    ["stacked-2", "stacked-3"],
  ])
})
