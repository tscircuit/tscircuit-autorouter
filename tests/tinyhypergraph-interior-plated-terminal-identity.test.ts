import { expect, test } from "bun:test"
import input from "../fixtures/features/portpointpathing/tinyhypergraph-port-bridge-repro-input.json"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import type {
  HgPortPointPathingSolverParams,
  RegionHg,
  RegionPortHg,
} from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/types"

test("preserves own endpoint IDs when traversing another connection's plated pad", () => {
  const region = (regionId: string, x: number, z: number): RegionHg => ({
    regionId,
    d: {
      capacityMeshNodeId: regionId,
      center: { x, y: 0 },
      width: 2,
      height: 2,
      layer: z === 0 ? "top" : "bottom",
      availableZ: [z],
    },
    ports: [],
  })
  const start = region("start", -2, 0)
  const padTop = region("pad-top", 0, 0)
  const padBottom = region("pad-bottom", 0, 1)
  const end = region("end", 2, 1)
  const port = (
    portId: string,
    region1: RegionHg,
    region2: RegionHg,
    x: number,
    z: number,
  ): RegionPortHg => {
    const result: RegionPortHg = {
      portId,
      region1,
      region2,
      d: {
        portId,
        x,
        y: 0,
        z,
        distToCentermostPortOnZ: 0,
        regions: [region1, region2],
      },
    }
    region1.ports.push(result)
    region2.ports.push(result)
    return result
  }
  const params: HgPortPointPathingSolverParams = {
    graph: {
      regions: [start, padTop, padBottom, end],
      ports: [
        port("top-edge", start, padTop, -1, 0),
        port("bottom-edge", padBottom, end, 1, 1),
      ],
    },
    connections: [
      {
        connectionId: "main",
        mutuallyConnectedNetworkId: "shared-net",
        startRegion: start,
        endRegion: end,
        simpleRouteConnection: {
          name: "main",
          pointsToConnect: [
            { x: -2, y: 0, layer: "top", pcb_port_id: "main-start" },
            { x: 2, y: 0, layer: "bottom", pcb_port_id: "main-end" },
          ],
        },
      },
      {
        connectionId: "pad",
        mutuallyConnectedNetworkId: "shared-net",
        startRegion: start,
        endRegion: padTop,
        simpleRouteConnection: {
          name: "pad",
          pointsToConnect: [
            { x: -2, y: 0, layer: "top", pcb_port_id: "pad-start" },
            {
              x: 0,
              y: 0,
              layers: ["top", "bottom"],
              pcb_port_id: "shared-pad",
            },
          ],
        },
      },
    ],
    layerCount: 2,
    effort: input.effort,
    flags: {
      ...input.flags,
      ENABLE_CONNECTED_TERMINAL_LAYER_CHOICES: true,
      USE_PHYSICAL_VIA_COSTS: true,
    },
    weights: input.weights,
    preserveTerminalPcbPortIds: true,
  }
  const solver = new TinyHypergraphPortPointPathingSolver(params)
  solver.solve()
  expect(solver.solved).toBe(true)
  const points = solver
    .getOutput()
    .nodesWithPortPoints.flatMap((node) => node.portPoints)
  const mainPoints = points.filter((point) => point.connectionName === "main")
  expect(
    mainPoints
      .filter((point) => point.pcb_port_id)
      .map((point) => point.pcb_port_id)
      .sort(),
  ).toEqual(["main-end", "main-start"])
  const interiorPadContacts = mainPoints.filter(
    (point) => point.x === 0 && point.y === 0,
  )
  expect(interiorPadContacts.map((point) => point.z).sort()).toEqual([0, 1])
  expect(interiorPadContacts.every((point) => !point.pcb_port_id)).toBe(true)
  expect(
    points
      .filter((point) => point.connectionName === "pad" && point.pcb_port_id)
      .map((point) => point.pcb_port_id)
      .sort(),
  ).toEqual(["pad-start", "shared-pad"])

  // Four-layer routing retains the shared-pad hints used by legacy HD solvers.
  const legacyParams = structuredClone(params)
  legacyParams.layerCount = 4
  for (const legacyRegion of legacyParams.graph.regions) {
    legacyRegion.d.availableZ = legacyRegion.d.availableZ.map((z) =>
      z === 1 ? 3 : z,
    )
  }
  for (const legacyPort of legacyParams.graph.ports) {
    if (legacyPort.d.z === 1) legacyPort.d.z = 3
  }
  const legacySolver = new TinyHypergraphPortPointPathingSolver(legacyParams)
  legacySolver.solve()
  expect(legacySolver.physicalViaMode).toBeFalse()
  expect(legacySolver.solved).toBeTrue()
  expect(legacySolver.failed).toBeFalse()
  const legacyMainPoints = legacySolver
    .getOutput()
    .nodesWithPortPoints.flatMap((node) => node.portPoints)
    .filter((point) => point.connectionName === "main")
  expect(
    legacyMainPoints
      .filter((point) => point.x === 0 && point.y === 0)
      .map((point) => ({ z: point.z, pcb_port_id: point.pcb_port_id }))
      .sort((first, second) => first.z - second.z),
  ).toEqual([
    { z: 0, pcb_port_id: "shared-pad" },
    { z: 3, pcb_port_id: "shared-pad" },
  ])
  expect(
    legacyMainPoints
      .filter((point) => point.x === -2 || point.x === 2)
      .map((point) => point.pcb_port_id)
      .sort(),
  ).toEqual(["main-end", "main-start"])
})
