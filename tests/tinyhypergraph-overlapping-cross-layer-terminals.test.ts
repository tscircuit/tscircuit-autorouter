import { expect, test } from "bun:test"
import input from "../fixtures/features/portpointpathing/tinyhypergraph-port-bridge-repro-input.json"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import type {
  HgPortPointPathingSolverParams,
  RegionHg,
} from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/types"

test("TinyHypergraph routes overlapping cross-layer terminals through one target region", () => {
  const startRegion: RegionHg = {
    regionId: "bottom-target",
    ports: [],
    d: {
      capacityMeshNodeId: "bottom-target",
      center: { x: 0, y: 0 },
      width: 0.59,
      height: 0.64,
      layer: "bottom",
      availableZ: [1],
      _containsTarget: true,
    },
  }
  const endRegion: RegionHg = {
    regionId: "top-target",
    ports: [],
    d: {
      capacityMeshNodeId: "top-target",
      center: { x: 0.17, y: 0 },
      width: 0.254,
      height: 0.254,
      layer: "top",
      availableZ: [0],
      _containsTarget: true,
    },
  }
  const params = structuredClone(input) as HgPortPointPathingSolverParams
  params.graph = { regions: [startRegion, endRegion], ports: [] }
  params.connections = [
    {
      connectionId: "cross-layer-targets",
      mutuallyConnectedNetworkId: "cross-layer-targets",
      startRegion,
      endRegion,
      simpleRouteConnection: {
        name: "cross-layer-targets",
        pointsToConnect: [
          { x: 0, y: 0, layer: "bottom", pointId: "bottom-port" },
          { x: 0.17, y: 0, layer: "top", pointId: "top-port" },
        ],
      },
    },
  ]
  params.layerCount = 2

  const solver = new TinyHypergraphPortPointPathingSolver(params)
  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  expect(solver.getOutput().nodesWithPortPoints).toEqual([
    expect.objectContaining({
      capacityMeshNodeId: "bottom-target",
      availableZ: [0, 1],
      portPoints: [
        expect.objectContaining({ x: 0, y: 0, z: 1 }),
        expect.objectContaining({ x: 0.17, y: 0, z: 0 }),
      ],
    }),
  ])
})
