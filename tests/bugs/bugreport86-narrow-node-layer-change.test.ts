import { describe, expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib"
import type { SegmentPortPoint } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import { buildHyperGraph } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/buildHyperGraph"
import type { HgPortPointPathingSolverParams } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/types"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import { migrateLegacyObstacleCircuitJsonMetadata } from "lib/testing/utils/migrate-legacy-obstacle-circuit-json-metadata"
import type {
  CapacityMeshNode,
  SimpleRouteConnection,
  SimpleRouteJson,
} from "lib/types"
import bugReport from "../../fixtures/bug-reports/bugreport86-40bf8e/bugreport86-40bf8e.json" with {
  type: "json",
}

const DEFAULT_FLAGS: HgPortPointPathingSolverParams["flags"] = {
  FORCE_CENTER_FIRST: false,
  RIPPING_ENABLED: true,
  USE_SELECTIVE_RERIP_ROUTING: true,
}

const DEFAULT_WEIGHTS: HgPortPointPathingSolverParams["weights"] = {
  SHUFFLE_SEED: 0,
  CENTER_OFFSET_DIST_PENALTY_FACTOR: 0,
  CENTER_OFFSET_FOCUS_SHIFT: 0,
  GREEDY_MULTIPLIER: 1,
  NODE_PF_FACTOR: 1,
  LAYER_CHANGE_COST: 1,
  RIPPING_PF_COST: 0,
  NODE_PF_MAX_PENALTY: 100,
  MEMORY_PF_FACTOR: 0,
  BASE_CANDIDATE_COST: 1,
  MIN_ALLOWED_BOARD_SCORE: -1e9,
  MAX_ITERATIONS_PER_PATH: 0,
  RANDOM_WALK_DISTANCE: 0,
  START_RIPPING_PF_THRESHOLD: 0.3,
  END_RIPPING_PF_THRESHOLD: 1,
  MAX_RIPS: 100,
  RANDOM_RIP_FRACTION: 0.3,
  STRAIGHT_LINE_DEVIATION_PENALTY_FACTOR: 0,
}

const makeNode = (params: {
  id: string
  x: number
  y: number
  width: number
  height: number
  availableZ: number[]
  containsTarget?: boolean
  connectedTo?: string[]
}): CapacityMeshNode => ({
  capacityMeshNodeId: params.id,
  center: { x: params.x, y: params.y },
  width: params.width,
  height: params.height,
  layer: "top",
  availableZ: params.availableZ,
  _containsTarget: params.containsTarget ?? false,
  _containsObstacle: Boolean(params.connectedTo?.length),
  _completelyInsideObstacle: false,
  _connectedTo: params.connectedTo ?? [],
})

const makeSegmentPortPoint = (params: {
  id: string
  nodeA: string
  nodeB: string
  x: number
  y: number
  availableZ: number[]
}): SegmentPortPoint => ({
  segmentPortPointId: params.id,
  edgeId: `${params.nodeA}-${params.nodeB}`,
  nodeIds: [params.nodeA, params.nodeB],
  x: params.x,
  y: params.y,
  availableZ: params.availableZ,
  connectionName: null,
  distToCentermostPortOnZ: 0,
  cramped: false,
})

describe("TinyHypergraphPortPointPathingSolver minViaPadDiameter node guard (#4041)", () => {
  test("splits multi-layer nodes smaller than minViaPadDiameter per layer while merging output nodes", () => {
    const minViaPadDiameter = 0.45
    const capacityMeshNodes: CapacityMeshNode[] = [
      makeNode({
        id: "cmn_pad_a",
        x: 0,
        y: 0,
        width: 0.12,
        height: 0.6,
        availableZ: [0, 1, 2, 3],
        containsTarget: true,
        connectedTo: ["conn_a"],
      }),
      makeNode({
        id: "cmn_narrow_corridor",
        x: 0.14,
        y: 0,
        width: 0.16,
        height: 0.8,
        availableZ: [0, 1, 2, 3],
      }),
      makeNode({
        id: "cmn_wide_fanout",
        x: 0.62,
        y: 0,
        width: 0.8,
        height: 0.8,
        availableZ: [0, 1, 2, 3],
      }),
      makeNode({
        id: "cmn_dest_a",
        x: 1.3,
        y: 0.2,
        width: 0.5,
        height: 0.5,
        availableZ: [2],
        containsTarget: true,
        connectedTo: ["conn_a"],
      }),
      makeNode({
        id: "cmn_start_b",
        x: 0.14,
        y: -0.7,
        width: 0.5,
        height: 0.5,
        availableZ: [2],
        containsTarget: true,
        connectedTo: ["conn_b"],
      }),
      makeNode({
        id: "cmn_dest_b",
        x: 0.14,
        y: 0.7,
        width: 0.5,
        height: 0.5,
        availableZ: [2],
        containsTarget: true,
        connectedTo: ["conn_b"],
      }),
    ]

    const segmentPortPoints: SegmentPortPoint[] = [
      makeSegmentPortPoint({
        id: "spp_pad_to_corridor",
        nodeA: "cmn_pad_a",
        nodeB: "cmn_narrow_corridor",
        x: 0.06,
        y: 0,
        availableZ: [0, 1, 2, 3],
      }),
      makeSegmentPortPoint({
        id: "spp_corridor_to_fanout",
        nodeA: "cmn_narrow_corridor",
        nodeB: "cmn_wide_fanout",
        x: 0.22,
        y: 0,
        availableZ: [0, 1, 2, 3],
      }),
      makeSegmentPortPoint({
        id: "spp_fanout_to_dest_a",
        nodeA: "cmn_wide_fanout",
        nodeB: "cmn_dest_a",
        x: 1.02,
        y: 0.2,
        availableZ: [2],
      }),
      makeSegmentPortPoint({
        id: "spp_b_in",
        nodeA: "cmn_start_b",
        nodeB: "cmn_narrow_corridor",
        x: 0.14,
        y: -0.4,
        availableZ: [2],
      }),
      makeSegmentPortPoint({
        id: "spp_b_out",
        nodeA: "cmn_narrow_corridor",
        nodeB: "cmn_dest_b",
        x: 0.14,
        y: 0.4,
        availableZ: [2],
      }),
    ]

    const simpleRouteJsonConnections: SimpleRouteConnection[] = [
      {
        name: "conn_a",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top" },
          { x: 1.3, y: 0.2, layer: "inner2" },
        ],
      },
      {
        name: "conn_b",
        pointsToConnect: [
          { x: 0.14, y: -0.7, layer: "inner2" },
          { x: 0.14, y: 0.7, layer: "inner2" },
        ],
      },
    ]

    const connectivityMap = new ConnectivityMap({
      net_a: ["conn_a"],
      net_b: ["conn_b"],
    })

    const { graph, connections } = buildHyperGraph({
      simpleRouteJsonConnections,
      capacityMeshNodes,
      segmentPortPoints,
      layerCount: 4,
      connectivityMap,
    })

    const solver = new TinyHypergraphPortPointPathingSolver({
      graph,
      connections,
      layerCount: 4,
      effort: 1,
      flags: DEFAULT_FLAGS,
      weights: DEFAULT_WEIGHTS,
      minViaPadDiameter,
    })

    solver.solve()
    expect(solver.solved).toBeTrue()
    expect(solver.failed).toBeFalse()

    const output = solver.getOutput()
    const nodeIds = output.nodesWithPortPoints.map((n) => n.capacityMeshNodeId)
    expect(new Set(nodeIds).size).toBe(nodeIds.length)

    const corridorNode = output.nodesWithPortPoints.find(
      (n) => n.capacityMeshNodeId === "cmn_narrow_corridor",
    )
    expect(corridorNode).toBeDefined()
    expect(corridorNode!.portPointsInPairs).toHaveLength(2)

    for (const node of output.nodesWithPortPoints) {
      const minSide = Math.min(node.width, node.height)
      for (const [p1, p2] of node.portPointsInPairs ?? []) {
        if (p1.z !== p2.z) {
          expect(minSide).toBeGreaterThanOrEqual(minViaPadDiameter - 1e-9)
          expect(node.capacityMeshNodeId).toBe("cmn_wide_fanout")
        }
      }
    }

    for (const inputNode of output.inputNodeWithPortPoints) {
      expect(inputNode.capacityMeshNodeId.includes("::z")).toBeFalse()
      for (const pp of inputNode.portPoints) {
        for (const ownerId of pp.connectionNodeIds) {
          expect(ownerId.includes("::z")).toBeFalse()
        }
      }
    }
  })

  test("preserves multi-layer endpoint access inside narrow nodes for plated holes / via-in-pad", () => {
    const capacityMeshNodes: CapacityMeshNode[] = [
      makeNode({
        id: "cmn_plated_narrow",
        x: 0,
        y: 0,
        width: 0.2,
        height: 0.2,
        availableZ: [0, 1],
        containsTarget: true,
        connectedTo: ["conn_th"],
      }),
      makeNode({
        id: "cmn_bottom_escape",
        x: 0.35,
        y: 0,
        width: 0.2,
        height: 0.5,
        availableZ: [1],
      }),
      makeNode({
        id: "cmn_dest_bottom",
        x: 0.8,
        y: 0,
        width: 0.5,
        height: 0.5,
        availableZ: [1],
        containsTarget: true,
        connectedTo: ["conn_th"],
      }),
    ]

    const segmentPortPoints: SegmentPortPoint[] = [
      makeSegmentPortPoint({
        id: "spp_th_escape",
        nodeA: "cmn_plated_narrow",
        nodeB: "cmn_bottom_escape",
        x: 0.1,
        y: 0,
        availableZ: [1],
      }),
      makeSegmentPortPoint({
        id: "spp_escape_dest",
        nodeA: "cmn_bottom_escape",
        nodeB: "cmn_dest_bottom",
        x: 0.45,
        y: 0,
        availableZ: [1],
      }),
    ]

    const simpleRouteJsonConnections: SimpleRouteConnection[] = [
      {
        name: "conn_th",
        pointsToConnect: [
          { x: 0, y: 0, layers: ["top", "bottom"] },
          { x: 0.8, y: 0, layer: "bottom" },
        ],
      },
    ]

    const connectivityMap = new ConnectivityMap({
      net_th: ["conn_th"],
    })

    const { graph, connections } = buildHyperGraph({
      simpleRouteJsonConnections,
      capacityMeshNodes,
      segmentPortPoints,
      layerCount: 2,
      connectivityMap,
    })

    const solver = new TinyHypergraphPortPointPathingSolver({
      graph,
      connections,
      layerCount: 2,
      effort: 1,
      flags: DEFAULT_FLAGS,
      weights: DEFAULT_WEIGHTS,
      minViaPadDiameter: 0.45,
    })

    solver.solve()
    expect(solver.solved).toBeTrue()
    expect(solver.failed).toBeFalse()
  })

  test("bugreport86-40bf8e portPointPathingSolver plans zero layer changes inside nodes smaller than viaDiameter", () => {
    const srj = migrateLegacyObstacleCircuitJsonMetadata(
      structuredClone(bugReport.simple_route_json) as SimpleRouteJson,
    )
    const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
      cacheProvider: null,
      effort: 1,
    })

    while (
      !pipeline.solved &&
      !pipeline.failed &&
      !pipeline.portPointPathingSolver
    ) {
      pipeline.step()
    }

    const ppp = pipeline.portPointPathingSolver
    expect(ppp).toBeDefined()
    ppp!.solve()

    expect(ppp!.error).toBeNull()
    expect(ppp!.failed).toBeFalse()
    expect(ppp!.solved).toBeTrue()

    const output = ppp!.getOutput()
    const seenNodeIds = new Set<string>()
    const narrowLayerChanges: Array<{
      nodeId: string
      width: number
      height: number
      fromZ: number
      toZ: number
    }> = []

    for (const node of output.nodesWithPortPoints) {
      expect(seenNodeIds.has(node.capacityMeshNodeId)).toBeFalse()
      seenNodeIds.add(node.capacityMeshNodeId)

      const minSide = Math.min(node.width, node.height)
      for (const [p1, p2] of node.portPointsInPairs ?? []) {
        if (p1.z !== p2.z && minSide + 1e-9 < pipeline.viaDiameter) {
          narrowLayerChanges.push({
            nodeId: node.capacityMeshNodeId,
            width: node.width,
            height: node.height,
            fromZ: p1.z,
            toZ: p2.z,
          })
        }
      }
    }

    expect(narrowLayerChanges).toEqual([])
    expect(output.changedPreloadedTraceSections).toHaveLength(0)
  })
})
