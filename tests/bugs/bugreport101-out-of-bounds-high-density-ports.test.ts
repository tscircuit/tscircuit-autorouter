import { expect, test } from "bun:test"
import type {
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"

type PairDefinition = {
  connectionName: string
  rootConnectionName: string
  start: { x: number; y: number; z: number }
  end: { x: number; y: number; z: number }
  startPortPointId?: string
  endPortPointId?: string
  startDuplicatedFromPortId?: string
  endDuplicatedFromPortId?: string
}

const pairDefinitions: PairDefinition[] = [
  {
    connectionName: "source_net_1_mst16",
    rootConnectionName: "source_net_1",
    start: { x: -0.10500135000003796, y: 9.899954799999955, z: 0 },
    end: { x: 1.2300027000000715, y: 7.774908999999752, z: 0 },
  },
  {
    connectionName: "source_net_2_mst12",
    rootConnectionName: "source_net_2",
    start: { x: -0.7000027000000744, y: 7.20001099999979, z: 0 },
    end: { x: 1.0050027000000714, y: 9.899954799999955, z: 0 },
  },
  {
    connectionName: "source_net_17_mst1",
    rootConnectionName: "source_net_17",
    start: { x: 1.2300027000000715, y: 0.23332844999996694, z: 3 },
    end: { x: 1.2300027000000715, y: 7.774908999999752, z: 3 },
  },
  {
    connectionName: "source_net_17_mst1",
    rootConnectionName: "source_net_17",
    start: { x: 1.2300027000000715, y: 8.137420449999803, z: 3 },
    end: { x: 1.0050027000000714, y: 9.899954799999955, z: 3 },
  },
  {
    connectionName: "source_net_7_mst1",
    rootConnectionName: "source_net_7",
    start: { x: -0.7000027000000744, y: 1.000124999999798, z: 0 },
    end: { x: 1.2544762946673786, y: 0.23843170034267572, z: 0 },
    endPortPointId: "ce6271_pp0_z0::0::dup1",
    endDuplicatedFromPortId: "ce6271_pp0_z0",
  },
  {
    connectionName: "source_net_6_mst1",
    rootConnectionName: "source_net_6",
    start: { x: -0.7000027000000744, y: 1.3999209999999493, z: 0 },
    end: { x: 1.2300027000000715, y: 0.23332844999996694, z: 0 },
  },
  {
    connectionName: "source_net_18",
    rootConnectionName: "source_net_18",
    start: { x: 0.26499999999999857, y: -1.000000220408026e-7, z: 0 },
    end: { x: 1.2300027000000715, y: 9.674954799999956, z: 0 },
  },
  {
    connectionName: "source_net_5",
    rootConnectionName: "source_net_5",
    start: { x: -0.7000027000000744, y: 7.599933999999848, z: 0 },
    end: { x: -0.7241646292150613, y: 0.05643136426814796, z: 0 },
    endPortPointId: "ce5803_pp0_z0_cramped::0::dup1",
    endDuplicatedFromPortId: "ce5803_pp0_z0_cramped",
  },
  {
    connectionName: "source_net_4",
    rootConnectionName: "source_net_4",
    start: { x: -0.6776083987020105, y: 7.61104684254222, z: 0 },
    end: { x: -0.7000027000000744, y: 0.05001254999992358, z: 0 },
  },
  {
    connectionName: "source_trace_45",
    rootConnectionName: "source_trace_45",
    start: { x: 1.2300027000000715, y: 1.9694256666666161, z: 0 },
    end: { x: -0.7000027000000744, y: 2.2000209999998788, z: 0 },
  },
]

const portPointsInPairs: [PortPoint, PortPoint][] = pairDefinitions.map(
  (
    {
      connectionName,
      rootConnectionName,
      start,
      end,
      startPortPointId,
      endPortPointId,
      startDuplicatedFromPortId,
      endDuplicatedFromPortId,
    },
    pairIndex,
  ) => {
    const startId = startPortPointId ?? `bugreport101_pair_${pairIndex}_start`
    const endId = endPortPointId ?? `bugreport101_pair_${pairIndex}_end`
    return [
      {
        ...start,
        connectionName,
        rootConnectionName,
        portPointId: startId,
        duplicatedFromPortId: startDuplicatedFromPortId,
        nextPortPointId: endId,
      },
      {
        ...end,
        connectionName,
        rootConnectionName,
        portPointId: endId,
        duplicatedFromPortId: endDuplicatedFromPortId,
        prevPortPointId: startId,
      },
    ]
  },
)

const sourceNode: NodeWithPortPoints = {
  capacityMeshNodeId: "bugreport101_topology_merge_1530__sub_1_0",
  center: { x: 0.26499999999999857, y: 4.949977349999967 },
  width: 1.9300054000001459,
  height: 9.899954899999978,
  portPointsInPairs,
  portPoints: portPointsInPairs.flat(),
}

const scaleFactor = 8
const scalePoint = (point: PortPoint): PortPoint => ({
  ...point,
  x: sourceNode.center.x + (point.x - sourceNode.center.x) * scaleFactor,
  y: sourceNode.center.y + (point.y - sourceNode.center.y) * scaleFactor,
})
const scaledNode: NodeWithPortPoints = {
  ...sourceNode,
  width: sourceNode.width * scaleFactor,
  height: sourceNode.height * scaleFactor,
  portPoints: sourceNode.portPoints.map(scalePoint),
  portPointsInPairs: sourceNode.portPointsInPairs?.map(([start, end]) => [
    scalePoint(start),
    scalePoint(end),
  ]),
}

test("bugreport101 routes synthetic ports outside a high-density node without fallback", () => {
  const fpNoisePortPointsInPairs: [PortPoint, PortPoint][] = [
    [
      {
        portPointId: "ordinary_boundary_port",
        x: 0.5000005,
        y: 0,
        z: 0,
        connectionName: "noise_test",
        rootConnectionName: "noise_test",
        nextPortPointId: "synthetic_boundary_port::dup1",
      },
      {
        portPointId: "synthetic_boundary_port::dup1",
        duplicatedFromPortId: "synthetic_boundary_port",
        x: -0.5000005,
        y: 0,
        z: 0,
        connectionName: "noise_test",
        rootConnectionName: "noise_test",
        prevPortPointId: "ordinary_boundary_port",
      },
    ],
  ]
  const fpNoiseNode: NodeWithPortPoints = {
    capacityMeshNodeId: "bugreport101_fp_noise_bounds",
    center: { x: 0, y: 0 },
    width: 1,
    height: 1,
    portPointsInPairs: fpNoisePortPointsInPairs,
    portPoints: fpNoisePortPointsInPairs.flat(),
  }
  const fpNoisePortfolio = new PortfolioSingleIntraNodeSolver({
    includeSyntheticPortBoundsForExternalSolvers: true,
    nodeWithPortPoints: fpNoiseNode,
    viaDiameter: 0.3,
    traceWidth: 0.15,
    obstacleMargin: 0.15,
    layerCount: 4,
  })

  expect(
    (fpNoisePortfolio as any).getNodeWithSyntheticPortInclusiveBounds(),
  ).toBe(fpNoiseNode)

  const solver = new GrowShrinkHighDensityIntraNodeSolver({
    includeSyntheticPortBoundsForExternalSolvers: true,
    nodeWithPortPoints: scaledNode,
    maxGrowthAttempts: 0,
    fallbackToInvalidGeometryOnFailure: true,
    captureSearchDebug: false,
    viaDiameter: 0.3,
    traceWidth: 0.15,
    obstacleMargin: 0.15,
    layerCount: 4,
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.stats.invalidGeometryFallback).not.toBe(true)
  expect(
    solver.solvedRoutes.map((route) => route.connectionName).sort(),
  ).toEqual(
    [
      "source_net_1_mst16",
      "source_net_2_mst12",
      "source_net_17_mst1",
      "source_net_17_mst1",
      "source_net_7_mst1",
      "source_net_6_mst1",
      "source_net_18",
      "source_net_5",
      "source_net_4",
      "source_trace_45",
    ].sort(),
  )
})
