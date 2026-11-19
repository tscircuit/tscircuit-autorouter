import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { ViaPossibilitiesSolver2 } from "lib/solvers/ViaPossibilitiesSolver/ViaPossibilitiesSolver2"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("joins same-net terminals while retaining foreign-net via detours", (): void => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "crossing-branches",
    center: { x: 0, y: 0 },
    width: 4,
    height: 4,
    availableZ: [0, 1],
    portPoints: [
      { x: -1, y: -1, z: 0, connectionName: "branch_a" },
      {
        x: 1,
        y: 0,
        z: 0,
        connectionName: "branch_a",
        pcb_port_id: "shared_pad",
      },
      { x: -1, y: 1, z: 0, connectionName: "branch_b" },
      {
        x: 1,
        y: 0,
        z: 0,
        connectionName: "branch_b",
        pcb_port_id: "shared_pad",
      },
    ],
  }
  const original = structuredClone(node)
  const shared = new ViaPossibilitiesSolver2({
    nodeWithPortPoints: node,
    connMap: new ConnectivityMap({ rail: ["branch_a", "branch_b"] }),
  })
  shared.solve()
  expect(shared.solved).toBeTrue()
  expect(shared.completedPaths.size).toBe(2)
  for (const path of shared.completedPaths.values()) {
    expect(path.every((point) => point.z === 0)).toBeTrue()
  }

  const crossingNode: NodeWithPortPoints = {
    ...node,
    portPoints: [
      { x: -2, y: -1, z: 0, connectionName: "branch_a" },
      { x: 2, y: 1, z: 0, connectionName: "branch_a" },
      { x: -2, y: 1, z: 0, connectionName: "branch_b" },
      { x: 2, y: -1, z: 0, connectionName: "branch_b" },
    ],
  }
  const foreign = new ViaPossibilitiesSolver2({
    nodeWithPortPoints: crossingNode,
    connMap: new ConnectivityMap({
      net_a: ["branch_a"],
      net_b: ["branch_b"],
    }),
  })
  foreign.solve()
  expect(foreign.solved).toBeTrue()
  expect(foreign.completedPaths.size).toBe(2)
  expect(
    [...foreign.completedPaths.values()].some((path) =>
      path.some((point) => point.z === 1),
    ),
  ).toBeTrue()

  const legacy = new ViaPossibilitiesSolver2({
    nodeWithPortPoints: crossingNode,
  })
  legacy.solve()
  expect(legacy.solved).toBeTrue()
  expect(foreign.completedPaths).toEqual(legacy.completedPaths)
  const interiorCrossing = new ViaPossibilitiesSolver2({
    nodeWithPortPoints: crossingNode,
    connMap: new ConnectivityMap({ rail: ["branch_a", "branch_b"] }),
  })
  interiorCrossing.solve()
  expect(interiorCrossing.solved).toBeTrue()
  expect(interiorCrossing.completedPaths).toEqual(legacy.completedPaths)
  expect(node).toEqual(original)
})
