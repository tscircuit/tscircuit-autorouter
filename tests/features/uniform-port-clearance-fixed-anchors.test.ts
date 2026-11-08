import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { UniformPortClearanceSolver } from "lib/solvers/UniformPortDistributionSolver/UniformPortClearanceSolver"
import type {
  PortPointWithOwnerPair,
  SharedEdge,
} from "lib/solvers/UniformPortDistributionSolver/types"

test("fixed anchors at the requested clearance stay fixed and closer ones fail", (): void => {
  const edge: SharedEdge = {
    ownerNodeIds: ["left", "right"],
    ownerPairKey: "left|right",
    orientation: "vertical",
    x1: 0,
    x2: 0,
    y1: 0,
    y2: 1,
    center: { x: 0, y: 0.5 },
    length: 1,
    nodeSideByOwnerId: { left: "right", right: "left" },
  }
  const ports: PortPointWithOwnerPair[] = [0, 0.2].map((y, index) => ({
    x: 0,
    y,
    z: 0,
    portPointId: `port${index}`,
    connectionName: `net${index}`,
    ownerNodeIds: edge.ownerNodeIds,
    ownerPairKey: edge.ownerPairKey,
  }))
  const input = {
    edges: new Map([[edge.ownerPairKey, edge]]),
    portsByEdge: new Map([[edge.ownerPairKey, ports]]),
    originalPositionsByPortId: new Map(
      ports.map((port) => [port.portPointId!, port]),
    ),
    boundsByPortId: new Map(
      ports.map((port) => [port.portPointId!, { min: port.y, max: port.y }]),
    ),
    connMap: new ConnectivityMap({}),
    separation: 0.2,
  }
  const solver = new UniformPortClearanceSolver(input)
  solver.solve()
  expect(solver.solved).toBeTrue()
  expect(solver.getOutput().get(edge.ownerPairKey)).toEqual(ports)
  expect(
    () => new UniformPortClearanceSolver({ ...input, separation: 0.201 }),
  ).toThrow("Fixed port clearance conflict")
})
