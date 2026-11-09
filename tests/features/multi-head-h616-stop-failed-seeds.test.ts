import { expect, test } from "bun:test"
import { MultiHeadPolyLineIntraNodeSolver3 } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver3_ViaPossibilitiesSolverIntegration"
import type { Candidate } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/types1"
import type {
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"

type NativePortPair = [
  trace: number,
  net: number,
  startX: number,
  startY: number,
  startZ: number,
  endY: number,
  endZ: number,
]

class SeedCountingSolver extends MultiHeadPolyLineIntraNodeSolver3 {
  attemptedSeeds: number[] = []

  override createInitialCandidateFromSeed(
    seed: number,
    retainedPolylineHashes?: ReadonlySet<string>,
  ): Candidate | null {
    this.attemptedSeeds.push(seed)
    return super.createInitialCandidateFromSeed(seed, retainedPolylineHashes)
  }
}

test("H616 stops generating seeds after a fatal via-limit failure", (): void => {
  // Actual H616 remaining-phase node cmn_0__sub_2_1, with all 20 ports.
  const topY = 3.5249999999999964
  const crampedY = 3.524999999999995
  const pairs: NativePortPair[] = [
    [49, 3, 2.6399999999999983, topY, 0, 1.3152777777777729, 3],
    [48, 4, 2.314999999999997, crampedY, 0, 1.3152777777777729, 2],
    [41, 11, 2.964999999999997, crampedY, 0, -7.523611111111116, 2],
    [40, 12, 1.989999999999998, topY, 0, -7.523611111111116, 3],
    [32, 20, 1.6649999999999971, crampedY, 0, 0.2104166666666618, 1],
    [31, 21, 0.36499999999999755, crampedY, 0, -6.418750000000005, 0],
    [29, 23, 0.6899999999999977, topY, 0, -6.418750000000005, 1],
    [27, 25, 1.0149999999999975, crampedY, 0, -3.1041666666666714, 3],
    [25, 27, 1.0149999999999975, crampedY, 2, -3.1041666666666714, 2],
    [16, 36, 1.6649999999999971, crampedY, 3, 0.2104166666666618, 0],
  ]
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "cmn_0__sub_2_1",
    center: { x: 6.625, y: -3.1041666666666714 },
    width: 13.25,
    height: 13.258333333333333,
    availableZ: [0, 1, 2, 3],
    portPoints: pairs.flatMap(
      ([trace, net, x, y, z, endY, endZ]): PortPoint[] => {
        const connectionName = `source_trace_${trace}`
        const rootConnectionName = `connectivity_net${net}`
        return [
          { x, y, z, connectionName, rootConnectionName },
          { x: 0, y: endY, z: endZ, connectionName, rootConnectionName },
        ]
      },
    ),
  }
  const solver = new SeedCountingSolver({
    nodeWithPortPoints: node,
    viaDiameter: 0.35,
  })
  solver.solve()

  expect(solver.failed).toBe(true)
  expect(solver.solved).toBe(false)
  expect(solver.error).toBe(
    "ViaPossibilitiesSolver2 failed with: Exceeded max via count of 5",
  )
  expect(solver.attemptedSeeds).toEqual([0])
  expect(solver.solvedRoutes).toEqual([])
})
