import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { UniformPortClearanceSolver } from "lib/solvers/UniformPortDistributionSolver/UniformPortClearanceSolver"
import type {
  PortPointWithOwnerPair,
  SharedEdge,
} from "lib/solvers/UniformPortDistributionSolver/types"

test("corner clearance can move both boundary ports without moving a fixed anchor", (): void => {
  const edges: SharedEdge[] = [
    {
      ownerNodeIds: ["inside", "below"],
      ownerPairKey: "inside|below",
      orientation: "horizontal",
      x1: -0.16,
      y1: 0,
      x2: 0,
      y2: 0,
      center: { x: -0.08, y: 0 },
      length: 0.16,
      nodeSideByOwnerId: { inside: "bottom", below: "top" },
    },
    {
      ownerNodeIds: ["inside", "right"],
      ownerPairKey: "inside|right",
      orientation: "vertical",
      x1: 0,
      y1: -0.16,
      x2: 0,
      y2: 0,
      center: { x: 0, y: -0.08 },
      length: 0.16,
      nodeSideByOwnerId: { inside: "right", right: "left" },
    },
  ]
  const ports: PortPointWithOwnerPair[] = edges.map((edge, index) => ({
    ...edge.center,
    z: 0,
    portPointId: `port${index}`,
    connectionName: `signal${index}`,
    ownerNodeIds: edge.ownerNodeIds,
    ownerPairKey: edge.ownerPairKey,
  }))
  const original = structuredClone(ports)
  const input = {
    edges: new Map(edges.map((edge) => [edge.ownerPairKey, edge])),
    portsByEdge: new Map(
      edges.map((edge, index) => [edge.ownerPairKey, [ports[index]!]]),
    ),
    originalPositionsByPortId: new Map(
      ports.map((port) => [port.portPointId!, port]),
    ),
    boundsByPortId: new Map(
      ports.map((port) => [port.portPointId!, { min: -0.16, max: 0 }]),
    ),
    connMap: new ConnectivityMap({}),
    separation: 0.200001,
  }
  const solver = new UniformPortClearanceSolver(input)
  solver.solve()
  expect(solver.solved).toBeTrue()
  const output = [...solver.getOutput().values()].flat()
  expect(
    Math.hypot(output[0]!.x - output[1]!.x, output[0]!.y - output[1]!.y),
  ).toBeGreaterThan(0.2)
  expect(output[0]!.x).toBeLessThan(-0.14)
  expect(output[1]!.y).toBeLessThan(-0.14)
  expect(output[0]!.y).toBe(0)
  expect(output[1]!.x).toBe(0)
  expect(ports).toEqual(original)
  const impossible = new UniformPortClearanceSolver({
    ...input,
    boundsByPortId: new Map([
      ["port0", { min: -0.08, max: -0.08 }],
      ["port1", { min: -0.16, max: 0 }],
    ]),
  })
  expect(() => impossible.solve()).toThrow(
    "Port clearance constraints did not converge",
  )
  expect(impossible.solved).toBeFalse()
})
