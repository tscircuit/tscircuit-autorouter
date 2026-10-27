import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { createPortPointPositionValidator, createPortReservationNetIds } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/createPortReservationNetIds"
import { UniformPortDistributionSolver } from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import type { Obstacle } from "lib/types"
import type { NodeWithPortPoints, PortPoint } from "lib/types/high-density-types"

test("actual hole6231 endpoint requires authoritative hole clearance for every net and Uniform move", () => {
  const hole: Obstacle = { type: "rect", shape: "circle", isNonPlatedHole: true,
    obstacleId: "pcb_hole_altium_6231", center: { x: 163.1273979, y: 139.68599952 },
    width: 1.27, height: 1.27, layers: ["top", "inner1", "inner2", "inner3", "inner4", "inner5", "inner6", "bottom"],
    connectedTo: [] }
  const actual: PortPoint = { portPointId: "ce274872_pp0_z0::0", x: 163.99989789999995,
    y: 139.78539861000002, z: 0, connectionName: "source_net_altium_pcb_263_mst0",
    rootConnectionName: "source_net_altium_pcb_263" }
  const connMap = new ConnectivityMap({ own: [actual.connectionName, actual.rootConnectionName!],
    other: ["other-route"] })
  const context = { obstacles: [hole], connMap, traceWidth: 0.1, traceToPadClearance: 0.1, layerCount: 8 }
  const model = { topology: { portCount: 1, portX: [actual.x], portY: [actual.y], portZ: [actual.z] },
    problem: { routeNet: Int32Array.from([0, 7]), routeMetadata: [
      { connectionId: actual.connectionName, mutuallyConnectedNetworkId: "own" },
      { connectionId: "other-route", mutuallyConnectedNetworkId: "other" },
    ] } }
  const reserve = (extra: number | undefined = undefined, obstacle = hole): number =>
    createPortReservationNetIds({ ...model, context: { ...context, obstacles: [obstacle], traceToHoleClearance: extra } })[0]!
  const before = JSON.stringify({ hole, actual, model })
  const edgeDistance = Math.hypot(actual.x - hole.center.x, actual.y - hole.center.y) - hole.width / 2
  expect(edgeDistance).toBeCloseTo(0.24314374056, 10)
  expect(0.25 - edgeDistance).toBeCloseTo(0.00685625944, 10)
  expect(reserve()).toBe(-2)
  expect(reserve(0.2)).toBe(-2)
  expect(reserve(0)).toBe(-1)
  expect(reserve(0.3)).toBe(-2)
  expect(reserve(0.2, { ...hole, connectedTo: [actual.connectionName] })).toBe(-2)
  expect(reserve(0.2, { ...hole, layers: ["inner1"] })).toBe(-1)
  expect(createPortPointPositionValidator(context)(actual)).toBe(false)
  expect(createPortPointPositionValidator(context)({ ...actual, connectionName: "other-route" })).toBe(false)
  expect(createPortPointPositionValidator({ ...context, traceToHoleClearance: 0 })(actual)).toBe(true)
  const tangent = { ...actual, x: hole.center.x + hole.width / 2 + 0.25, y: hole.center.y }
  expect(createPortPointPositionValidator(context)(tangent)).toBe(true)
  expect(createPortPointPositionValidator(context)({ ...tangent, x: tangent.x - 0.0001 })).toBe(false)
  expect(() => reserve(-0.1)).toThrow("Invalid physical")

  // A valid old placement on a face must not move onto the actual unsafe XY.
  const original = { ...actual, x: actual.x + 0.02 }
  const owners: [string, string] = ["above", "below"]
  const nodes: NodeWithPortPoints[] = owners.map((id, index) => ({
    capacityMeshNodeId: id, center: { x: actual.x, y: actual.y + (index === 0 ? 0.5 : -0.5) },
    width: 0.06, height: 1, availableZ: [0], portPoints: [{ ...original }],
  }))
  const input = { nodeWithPortPoints: nodes, inputNodesWithPortPoints: nodes.map((n) => ({ ...n,
    portPoints: n.portPoints.map((p) => ({ ...p, connectionNodeIds: owners, distToCentermostPortOnZ: 0 })),
  })), obstacles: [hole], layerCount: 8, useLayerAwareGeometry: true }
  const allowed = createPortPointPositionValidator(context)
  expect(allowed(original)).toBe(true)
  const legacy = new UniformPortDistributionSolver(input)
  legacy.solve()
  expect(allowed(legacy.getOutput()[0]!.portPoints[0]!)).toBe(false)
  const guarded = new UniformPortDistributionSolver({ ...input, isPortPointPositionAllowed: allowed })
  guarded.solve()
  expect(guarded.solved).toBe(true)
  expect(guarded.getOutput()[0]!.portPoints[0]!.x).toBe(original.x)
  expect(JSON.stringify({ hole, actual, model })).toBe(before)
})
