import { expect, test } from "bun:test"
import { TinyHypergraphRegionPathingSolver } from "lib/autorouter-pipelines/AutoroutingPipeline10_ApproximateHypergraph/TinyHypergraphRegionPathingSolver"
import type {
  HgPortPointPathingSolverParams,
  RegionHg,
  RegionPortHg,
} from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/types"

test("Pipeline10 solves coarse region paths and materializes layer-aware ports", () => {
  const regions: RegionHg[] = ["a", "b", "c"].map((regionId, index) => ({
    regionId,
    d: {
      capacityMeshNodeId: regionId,
      center: { x: index * 2, y: 0 },
      width: 2,
      height: 2,
      layer: "z0,1",
      availableZ: [0, 1],
      _skipEndpointNetReservation: true,
    },
    ports: [],
  }))
  const ports: RegionPortHg[] = []
  for (const [edgeIndex, [region1, region2]] of [
    [regions[0]!, regions[1]!],
    [regions[1]!, regions[2]!],
  ].entries()) {
    for (const z of [0, 1]) {
      const portId = `edge-${edgeIndex}-z${z}`
      const port: RegionPortHg = {
        portId,
        region1,
        region2,
        d: {
          portId,
          x: edgeIndex * 2 + 1,
          y: 0,
          z,
          distToCentermostPortOnZ: 0,
          regions: [region1, region2],
        },
      }
      ports.push(port)
      region1.ports.push(port)
      region2.ports.push(port)
    }
  }
  const params: HgPortPointPathingSolverParams = {
    graph: { regions, ports },
    connections: [
      {
        connectionId: "trace",
        mutuallyConnectedNetworkId: "net",
        startRegion: regions[0]!,
        endRegion: regions[2]!,
        simpleRouteConnection: {
          name: "trace",
          pointsToConnect: [
            { x: 0, y: 0, layer: "top", pcb_port_id: "start" },
            { x: 4, y: 0, layer: "bottom", pcb_port_id: "end" },
          ],
        },
      },
    ],
    layerCount: 2,
    effort: 1,
    preserveTerminalPcbPortIds: true,
    flags: { FORCE_CENTER_FIRST: true, RIPPING_ENABLED: true },
    weights: {
      SHUFFLE_SEED: 0,
      CENTER_OFFSET_DIST_PENALTY_FACTOR: 0,
      CENTER_OFFSET_FOCUS_SHIFT: 0,
      GREEDY_MULTIPLIER: 0,
      NODE_PF_FACTOR: 0,
      LAYER_CHANGE_COST: 0,
      RIPPING_PF_COST: 0,
      NODE_PF_MAX_PENALTY: 0,
      MEMORY_PF_FACTOR: 0,
      BASE_CANDIDATE_COST: 0,
      MIN_ALLOWED_BOARD_SCORE: 0,
      MAX_ITERATIONS_PER_PATH: 0,
      RANDOM_WALK_DISTANCE: 0,
      START_RIPPING_PF_THRESHOLD: 0,
      END_RIPPING_PF_THRESHOLD: 0,
      MAX_RIPS: 0,
      RANDOM_RIP_FRACTION: 0,
      STRAIGHT_LINE_DEVIATION_PENALTY_FACTOR: 0,
    },
  }
  const solver = new TinyHypergraphRegionPathingSolver(params)

  solver.solve()
  const output = solver.getOutput()

  expect(solver.stats.mode).toBe("region-path")
  expect(solver.stats.solvedRouteCount).toBe(1)
  expect(output.nodesWithPortPoints).toHaveLength(3)
  expect(
    output.nodesWithPortPoints.flatMap((node) => node.portPoints),
  ).toContainEqual(expect.objectContaining({ pcb_port_id: "start", z: 0 }))
  expect(
    output.nodesWithPortPoints.flatMap((node) => node.portPoints),
  ).toContainEqual(expect.objectContaining({ pcb_port_id: "end", z: 1 }))
  expect(
    output.nodesWithPortPoints.some((node) =>
      node.portPointsInPairs?.some(([start, end]) => start.z !== end.z),
    ),
  ).toBe(true)
})
