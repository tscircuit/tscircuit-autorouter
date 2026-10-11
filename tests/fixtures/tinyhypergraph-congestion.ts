import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import {
  loadSerializedHyperGraph,
  TinyHyperGraphSolver,
} from "tiny-hypergraph/lib/index"

export const createTinyHypergraphCongestionFixture = (): SerializedHyperGraph => {
  const regionDefinitions: Array<[string, number, number, string[]]> = [
    ["flex-start", -0.6, 0, ["flex-in"]],
    ["left", -0.4, 0.2, ["flex-in", "hot-in", "cool-in"]],
    ["hot", 0, 0, ["hot-in", "hot-out", "fixed-in", "fixed-out"]],
    ["cool", 0, 0.4, ["cool-in", "cool-out"]],
    ["right", 0.4, 0.2, ["hot-out", "cool-out", "flex-out"]],
    ["flex-end", 0.6, 0, ["flex-out"]],
    ["fixed-start", 0, 0.4, ["fixed-in"]],
    ["fixed-end", 0, -0.4, ["fixed-out"]],
  ]
  const portDefinitions: Array<[string, string, string, number, number]> = [
    ["flex-in", "flex-start", "left", -0.5, 0],
    ["hot-in", "left", "hot", -0.2, 0],
    ["hot-out", "hot", "right", 0.2, 0],
    ["cool-in", "left", "cool", -0.2, 0.4],
    ["cool-out", "cool", "right", 0.2, 0.4],
    ["flex-out", "right", "flex-end", 0.5, 0],
    ["fixed-in", "fixed-start", "hot", 0, 0.2],
    ["fixed-out", "hot", "fixed-end", 0, -0.2],
  ]
  return {
    regions: regionDefinitions.map(([regionId, x, y, pointIds]) => ({
      regionId,
      pointIds,
      d: { center: { x, y }, width: 0.4, height: 0.4, availableZ: [0] },
    })),
    ports: portDefinitions.map(([portId, region1Id, region2Id, x, y]) => ({
      portId,
      region1Id,
      region2Id,
      d: { x, y, z: 0 },
    })),
    connections: [
      {
        connectionId: "flexible-route",
        startRegionId: "flex-start",
        endRegionId: "flex-end",
        mutuallyConnectedNetworkId: "flexible-net",
      },
      {
        connectionId: "fixed-route",
        startRegionId: "fixed-start",
        endRegionId: "fixed-end",
        mutuallyConnectedNetworkId: "fixed-net",
      },
    ],
  }
}

export const createTinyHypergraphCongestionSolver = (
  graph: SerializedHyperGraph,
): TinyHyperGraphSolver => {
  const { topology, problem } = loadSerializedHyperGraph(graph)
  return new TinyHyperGraphSolver(topology, problem, {
    RIP_THRESHOLD_RAMP_ATTEMPTS: 0,
    STATIC_REACHABILITY_PRECHECK: false,
  })
}
