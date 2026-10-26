import { expect, test } from "bun:test"
import { PhysicalSharedEdgePlacement } from "lib/solvers/UniformPortDistributionSolver/PhysicalSharedEdgePlacement"
import type {
  PortPointWithOwnerPair,
  SharedEdge,
} from "lib/solvers/UniformPortDistributionSolver/types"
import type { SimpleRouteJson } from "lib/types"

test("nominal pitch is preferred when the original face has room and legal tight domains remain usable", (): void => {
  const board: SimpleRouteJson = {
    layerCount: 8,
    minTraceWidth: 0.1,
    bounds: { minX: -10, maxX: 300, minY: -10, maxY: 200 },
    obstacles: [],
    connections: [106, 136].map((net) => ({
      name: `source_net_altium_pcb_${net}`,
      width: 0.1,
      pointsToConnect: [],
    })),
  }
  const edge: SharedEdge = {
    ownerNodeIds: ["cmn_746", "topology_merge_61247"],
    ownerPairKey: "cmn_746|topology_merge_61247",
    orientation: "vertical",
    x1: 279.2856999999999,
    x2: 279.2856999999999,
    y1: 69.288401,
    y2: 69.6087,
    center: { x: 279.2856999999999, y: 69.4485505 },
    length: 0.32029900000000566,
    nodeSideByOwnerId: { cmn_746: "right", topology_merge_61247: "left" },
  }
  const ports: PortPointWithOwnerPair[] = [106, 136].map((net, i) => ({
    portPointId: `ce239082_pp0_z0_cramped::0::dup${i + 2}`,
    connectionName: `source_net_altium_pcb_${net}`,
    rootConnectionName: `source_net_altium_pcb_${net}`,
    x: edge.x1,
    y: i === 0 ? 69.36847574999999 : 69.563475751,
    z: 0,
    ownerNodeIds: edge.ownerNodeIds,
    ownerPairKey: edge.ownerPairKey,
  }))
  const before = structuredClone(ports)
  const placed = new PhysicalSharedEdgePlacement(board, 0.1).redistribute(
    edge,
    ports,
  )
  expect(placed[1]!.y - placed[0]!.y).toBeGreaterThanOrEqual(0.2)
  expect(placed[0]!.y).toBeCloseTo(69.36847574999999, 10)
  expect(placed[1]!.y).toBeCloseTo(69.56847574999999, 10)
  expect(ports).toEqual(before)
  expect(placed.map((p) => p.portPointId)).toEqual(
    ports.map((p) => p.portPointId),
  )

  const tight = {
    ...edge,
    x1: 0,
    x2: 0.195,
    y1: 0,
    y2: 0,
    orientation: "horizontal" as const,
    center: { x: 0.0975, y: 0 },
    length: 0.195,
  }
  const tightPorts = ports.map((p, i) => ({ ...p, x: i * 0.195, y: 0 }))
  const tightPlaced = new PhysicalSharedEdgePlacement(board, 0.1).redistribute(
    tight,
    tightPorts,
  )
  expect(tightPlaced[1]!.x - tightPlaced[0]!.x).toBeCloseTo(0.195, 12)

  const mixed: SimpleRouteJson = {
    ...board,
    connections: [
      {
        name: "wide",
        nominalTraceWidth: 0.5,
        __rootConnectionNames: ["a"],
        pointsToConnect: [],
      },
      {
        name: "narrow",
        nominalTraceWidth: 0.1,
        __rootConnectionNames: ["a"],
        pointsToConnect: [],
      },
      { name: "foreign", nominalTraceWidth: 0.1, pointsToConnect: [] },
    ],
  }
  const mixedEdge = {
    ...tight,
    x2: 0.55,
    length: 0.55,
    center: { x: 0.275, y: 0 },
  }
  const mixedPorts = ["wide", "narrow", "foreign"].map((name, i) => ({
    ...ports[0]!,
    portPointId: name,
    connectionName: name,
    rootConnectionName: i < 2 ? "a" : "foreign",
    x: ((i + 0.5) * 0.55) / 3,
    y: 0,
  }))
  const mixedPlaced = new PhysicalSharedEdgePlacement(mixed).redistribute(
    mixedEdge,
    mixedPorts,
  )
  expect(mixedPlaced[1]!.x).toBeCloseTo(0.275, 12)
  expect(mixedPlaced[2]!.x - mixedPlaced[0]!.x).toBeGreaterThanOrEqual(
    0.4 - 1e-12,
  )
  expect(mixedPlaced[2]!.x - mixedPlaced[1]!.x).toBeGreaterThanOrEqual(
    0.2 - 1e-12,
  )
})
