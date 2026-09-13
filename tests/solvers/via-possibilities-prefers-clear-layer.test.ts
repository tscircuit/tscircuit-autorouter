import { expect, test } from "bun:test"
import { ViaPossibilitiesSolver2 } from "lib/solvers/ViaPossibilitiesSolver/ViaPossibilitiesSolver2"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("via possibilities uses a clear third layer instead of bouncing between occupied layers", () => {
  const pair = (
    connectionName: string,
    start: { x: number; y: number; z: number },
    end: { x: number; y: number; z: number },
  ) => [
    { ...start, connectionName },
    { ...end, connectionName },
  ] as NonNullable<NodeWithPortPoints["portPointsInPairs"]>[number]

  const portPointsInPairs = [
    pair("A_BLOCK_TOP", { x: -1, y: -4, z: 0 }, { x: -1, y: 4, z: 0 }),
    pair("B_BLOCK_TOP", { x: 1, y: -4, z: 0 }, { x: 1, y: 4, z: 0 }),
    pair("C_BLOCK_MIDDLE", { x: 0, y: -4, z: 1 }, { x: 0, y: 4, z: 1 }),
    pair("Z_TARGET", { x: -4, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }),
  ]
  const solver = new ViaPossibilitiesSolver2({
    nodeWithPortPoints: {
      capacityMeshNodeId: "three-layer-crossing",
      center: { x: 0, y: 0 },
      width: 10,
      height: 10,
      availableZ: [0, 1, 2],
      portPoints: portPointsInPairs.flat(),
      portPointsInPairs,
    },
  })

  while (
    !solver.completedPaths.has("Z_TARGET") &&
    !solver.failed &&
    solver.iterations < 100
  ) {
    solver.step()
  }

  expect(solver.failed).toBeFalse()
  expect(solver.completedPaths.get("Z_TARGET")?.some(({ z }) => z === 2)).toBe(
    true,
  )
})
