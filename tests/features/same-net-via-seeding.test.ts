import { expect, test } from "bun:test"
import { ViaPossibilitiesSolver2 } from "lib/solvers/ViaPossibilitiesSolver/ViaPossibilitiesSolver2"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import nodeFixture from "tests/fixtures/ecp5-vref-fanout-node.json" with {
  type: "json",
}

test("VREF seed paths share copper while foreign nets still block them", (): void => {
  const node = nodeFixture as NodeWithPortPoints
  for (let seed = 0; seed < 6; seed++) {
    const solver = new ViaPossibilitiesSolver2({
      nodeWithPortPoints: node,
      hyperParameters: { SHUFFLE_SEED: seed },
    })
    solver.solve()
    expect(solver.solved).toBeTrue()
    expect(solver.completedPaths.size).toBe(3)
    for (const [connectionName, path] of solver.completedPaths) {
      const ports = node.portPoints.filter(
        (port) => port.connectionName === connectionName,
      )
      expect(path[0]).toEqual(ports[0])
      expect(path.at(-1)).toEqual(ports[1])
      expect(path.every((point) => point.z === 0)).toBeTrue()
    }
  }
  const foreignNets = new ViaPossibilitiesSolver2({
    nodeWithPortPoints: {
      capacityMeshNodeId: "foreign-crossing",
      center: { x: 0, y: 0 },
      width: 10,
      height: 10,
      portPoints: [
        { x: -5, y: -4, z: 0, connectionName: "first" },
        { x: 5, y: 4, z: 0, connectionName: "first" },
        { x: -5, y: 4, z: 0, connectionName: "second" },
        { x: 5, y: -4, z: 0, connectionName: "second" },
      ],
    },
  })
  foreignNets.solve()
  expect(foreignNets.solved).toBeTrue()
  expect(
    [...foreignNets.completedPaths.values()].some((path) =>
      path.some((point) => point.z !== 0),
    ),
  ).toBeTrue()
})
