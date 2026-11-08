import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { UniformPortClearanceSolver } from "lib/solvers/UniformPortDistributionSolver/UniformPortClearanceSolver"
import type {
  PortPointWithOwnerPair,
  SharedEdge,
} from "lib/solvers/UniformPortDistributionSolver/types"

test("aligned opposite-edge ports retain their original separable direction", (): void => {
  const edges: SharedEdge[] = [0, 0.16].map((y, index) => ({
    ownerNodeIds: ["middle", `outside${index}`],
    ownerPairKey: `middle|outside${index}`,
    orientation: "horizontal",
    x1: -0.5,
    x2: 0.5,
    y1: y,
    y2: y,
    center: { x: 0, y },
    length: 1,
    nodeSideByOwnerId: {
      middle: index === 0 ? "bottom" : "top",
      [`outside${index}`]: index === 0 ? "top" : "bottom",
    },
  }))
  const ports: PortPointWithOwnerPair[] = edges.map((edge, index) => ({
    ...edge.center,
    z: 0,
    portPointId: `port${index}`,
    connectionName: `net${index}`,
    ownerNodeIds: edge.ownerNodeIds,
    ownerPairKey: edge.ownerPairKey,
  }))
  const solver = new UniformPortClearanceSolver({
    edges: new Map(edges.map((edge) => [edge.ownerPairKey, edge])),
    portsByEdge: new Map(
      edges.map((edge, index) => [edge.ownerPairKey, [ports[index]!]]),
    ),
    originalPositionsByPortId: new Map([
      ["port0", { x: -0.2, y: 0 }],
      ["port1", { x: 0.2, y: 0.16 }],
    ]),
    boundsByPortId: new Map(
      ports.map((port) => [port.portPointId!, { min: -0.5, max: 0.5 }]),
    ),
    connMap: new ConnectivityMap({}),
    separation: 0.200001,
  })
  solver.solve()
  expect(solver.solved).toBeTrue()
  const result = [...solver.getOutput().values()].flat()
  expect(
    Math.hypot(result[0]!.x - result[1]!.x, result[0]!.y - result[1]!.y),
  ).toBeGreaterThan(0.2)
  expect(result[0]!.x).toBeLessThan(0)
  expect(result[1]!.x).toBeGreaterThan(0)
  expect(result.map((port) => port.y)).toEqual([0, 0.16])
  expect(ports.map((port) => port.x)).toEqual([0, 0])
})
