import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { TopologyMergingSolver } from "lib/solvers/TopologyMergingSolver/TopologyMergingSolver"
import { prepareTopologyMergingInput } from "lib/solvers/TopologyMergingSolver/topology-merging-input"
import {
  createTopologyMergingOutputNodes,
  type TopologyMergingOutputProvenance,
} from "lib/solvers/TopologyMergingSolver/topology-merging-output"
import {
  compactClosedAtomicRegions,
  compactTopologyMergingRegions,
  restoreAuthoritativeTargetRegions,
} from "lib/solvers/TopologyMergingSolver/topology-merging-regions"
import type {
  TopologyMergingNodeGroup,
  TopologyMergingSolverParams,
} from "lib/solvers/TopologyMergingSolver/topology-merging-types"
import type { CapacityMeshNode, Obstacle, SimpleRouteJson } from "lib/types"

function createFourLayerUsbSrj(): SimpleRouteJson {
  const obstacles: Obstacle[] = []
  const connectorPinXs: number[] = [-1.5, -0.75, -0.25, 0.25, 0.75, 1.5]
  for (let index = 0; index < connectorPinXs.length; index++) {
    const pinX = connectorPinXs[index]!
    const connectedNet =
      index === 1 || index === 3
        ? ["source_net_68"]
        : index === 2 || index === 4
          ? ["source_net_69"]
          : [`guard_net_${index}`]
    obstacles.push({
      type: "rect",
      layers: ["top"],
      center: { x: pinX, y: -7.5 },
      width: 0.3,
      height: 0.9,
      connectedTo: connectedNet,
    })
  }

  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 3; col++) {
      const centerX = -3 + col * 3
      const centerY = -2.5 + row * 4
      obstacles.push({
        type: "rect",
        layers: ["top", "inner1", "inner2", "bottom"],
        center: { x: centerX, y: centerY },
        width: 1.0,
        height: 0.9,
        connectedTo: [`plane_block_${row}_${col}`],
      })
    }
  }

  obstacles.push(
    {
      type: "rect",
      layers: ["top"],
      center: { x: -3.5, y: 5.5 },
      width: 0.6,
      height: 0.6,
      connectedTo: ["source_net_68"],
    },
    {
      type: "rect",
      layers: ["top"],
      center: { x: -2.0, y: 5.5 },
      width: 0.6,
      height: 0.6,
      connectedTo: ["source_net_69"],
    },
    {
      type: "rect",
      layers: ["top"],
      center: { x: 2.5, y: 7.5 },
      width: 0.6,
      height: 0.6,
      connectedTo: ["source_net_68"],
    },
    {
      type: "rect",
      layers: ["top"],
      center: { x: 4.0, y: 7.5 },
      width: 0.6,
      height: 0.6,
      connectedTo: ["source_net_69"],
    },
  )

  return {
    layerCount: 4,
    minTraceWidth: 0.2,
    minViaPadDiameter: 0.7,
    defaultObstacleMargin: 0.2,
    minTraceToPadEdgeClearance: 0.2,
    minBoardEdgeClearance: 0.25,
    allowBlindAndBuriedVias: false,
    bounds: { minX: -8, maxX: 8, minY: -10, maxY: 10 },
    obstacles,
    differentialPairs: [
      {
        connectionNames: ["source_net_69", "source_net_68"],
        lengthTolerance: 0.5,
        traceGap: 0.2101,
        maxUncoupledLength: 5,
      },
    ],
    connections: [
      {
        name: "source_net_68",
        nominalTraceWidth: 0.2979,
        pointsToConnect: [
          { x: -0.75, y: -7.5, layer: "top", pointId: "usb_dn_a7" },
          { x: 0.25, y: -7.5, layer: "top", pointId: "usb_dn_b7" },
          { x: -3.5, y: 5.5, layer: "top", pointId: "usb_dn_esd" },
          { x: 2.5, y: 7.5, layer: "top", pointId: "usb_dn_mcu" },
        ],
      },
      {
        name: "source_net_69",
        nominalTraceWidth: 0.2979,
        pointsToConnect: [
          { x: -0.25, y: -7.5, layer: "top", pointId: "usb_dp_a6" },
          { x: 0.75, y: -7.5, layer: "top", pointId: "usb_dp_b6" },
          { x: -2.0, y: 5.5, layer: "top", pointId: "usb_dp_esd" },
          { x: 4.0, y: 7.5, layer: "top", pointId: "usb_dp_mcu" },
        ],
      },
    ],
  }
}

function createHighRegionCountTopologyProblem(): TopologyMergingSolverParams {
  const columnCount = 220
  const bottomSliceCount = 260
  const boardWidth = columnCount * 2
  const boardHeight = 60
  const globalNodes: CapacityMeshNode[] = []
  const topComponentNodes: CapacityMeshNode[] = []
  for (let col = 0; col < columnCount; col++) {
    const centerX = col * 2 + 1
    globalNodes.push({
      capacityMeshNodeId: `global_col_${col}`,
      center: { x: centerX, y: boardHeight / 2 },
      width: 2,
      height: boardHeight,
      layer: "top",
      availableZ: [0, 1, 2, 3],
      _containsObstacle: true,
    })
    topComponentNodes.push({
      capacityMeshNodeId: `comp_top_col_${col}`,
      center: { x: centerX, y: boardHeight / 2 },
      width: 2,
      height: boardHeight,
      layer: "top",
      availableZ: [0],
      _containsObstacle: true,
    })
  }
  const bottomSliceNodes: CapacityMeshNode[] = []
  for (let slice = 0; slice < bottomSliceCount; slice++) {
    bottomSliceNodes.push({
      capacityMeshNodeId: `comp_bot_slice_${slice}`,
      center: { x: boardWidth / 2, y: 1 + slice * 0.2 },
      width: boardWidth,
      height: 0.08,
      layer: "bottom",
      availableZ: [3],
      _containsObstacle: true,
    })
  }

  const nodeGroups: TopologyMergingNodeGroup[] = [
    { groupId: "global", nodes: globalNodes, isComponent: false },
    { groupId: "component-0", nodes: topComponentNodes, isComponent: true },
    { groupId: "component-1", nodes: bottomSliceNodes, isComponent: true },
  ]
  return {
    layerCount: 4,
    allowBlindAndBuriedVias: false,
    nodeGroups,
  }
}

test("Pipeline9 rejects multi-terminal USB differential pairs at netToPointPairsSolver and bounds TopologyMergingSolver retained regions", (): void => {
  const unsupportedUsbSrj = createFourLayerUsbSrj()
  const fastFailSolver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    unsupportedUsbSrj,
    {
      effort: 1,
      cacheProvider: null,
    },
  )
  while (!fastFailSolver.solved && !fastFailSolver.failed) {
    fastFailSolver.step()
  }

  expect(fastFailSolver.solved).toBe(false)
  expect(fastFailSolver.failed).toBe(true)
  expect(fastFailSolver.getCurrentPhase()).toBe("netToPointPairsSolver")
  expect(fastFailSolver.topologyPlanningSolver).toBeUndefined()
  expect(fastFailSolver.topologyMergingSolver).toBeUndefined()
  expect(fastFailSolver.error).toContain("Pipeline9 [netToPointPairsSolver]")
  expect(fastFailSolver.error).toContain("source_net_69/source_net_68")
  expect(fastFailSolver.error).toContain("(4 terminals)")
  expect(fastFailSolver.error).toContain(
    'differential pair "source_net_69/source_net_68" connection "source_net_69" (4 terminals) must resolve to exactly one final point-pair connection, got 3',
  )

  const unconstrainedUsbSrj: SimpleRouteJson = {
    ...createFourLayerUsbSrj(),
    differentialPairs: [],
  }
  const unconstrainedSolver =
    new AutoroutingPipelineSolver9_PreloadedTraceGraph(unconstrainedUsbSrj, {
      effort: 1,
      cacheProvider: null,
    })
  while (!unconstrainedSolver.solved && !unconstrainedSolver.failed) {
    unconstrainedSolver.step()
  }
  expect(unconstrainedSolver.failed, unconstrainedSolver.error ?? "").toBe(
    false,
  )
  expect(unconstrainedSolver.solved).toBe(true)
  expect(
    unconstrainedSolver.getOutputSimpleRouteJson().traces?.length ?? 0,
  ).toBeGreaterThanOrEqual(2)

  const twoTerminalDiffPairSrj: SimpleRouteJson = {
    ...createFourLayerUsbSrj(),
    connections: [
      {
        name: "source_net_68",
        nominalTraceWidth: 0.2979,
        pointsToConnect: [
          { x: -0.75, y: -7.5, layer: "top", pointId: "usb_dn_a7" },
          { x: 2.5, y: 7.5, layer: "top", pointId: "usb_dn_mcu" },
        ],
      },
      {
        name: "source_net_69",
        nominalTraceWidth: 0.2979,
        pointsToConnect: [
          { x: -0.25, y: -7.5, layer: "top", pointId: "usb_dp_a6" },
          { x: 4.0, y: 7.5, layer: "top", pointId: "usb_dp_mcu" },
        ],
      },
    ],
  }
  const twoTerminalSolver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    twoTerminalDiffPairSrj,
    {
      effort: 1,
      cacheProvider: null,
    },
  )
  while (!twoTerminalSolver.solved && !twoTerminalSolver.failed) {
    twoTerminalSolver.step()
  }
  expect(twoTerminalSolver.failed, twoTerminalSolver.error ?? "").toBe(false)
  expect(twoTerminalSolver.solved).toBe(true)
  expect(twoTerminalSolver.lengthMatchingPostProcessingSolver?.solved).toBe(
    true,
  )

  const denseTopologyProblem = createHighRegionCountTopologyProblem()
  const merger = new TopologyMergingSolver(denseTopologyProblem)
  let peakRetainedAtomicRegions = 0
  while (!merger.solved && !merger.failed) {
    merger.step()
    peakRetainedAtomicRegions = Math.max(
      peakRetainedAtomicRegions,
      merger.stats.atomicRegionCount ?? 0,
    )
  }
  expect(merger.failed, merger.error ?? "").toBe(false)
  expect(merger.solved).toBe(true)
  expect(merger["totalCreatedAtomicRegionCount"]).toBeGreaterThan(250_000)
  expect(peakRetainedAtomicRegions).toBeLessThan(250_000)
  expect(merger.getOutput().length).toBeGreaterThan(0)
  expect(merger["atomicRegions"]).toHaveLength(0)
  expect(merger["preparedNodes"]).toHaveLength(0)
  expect(merger["nodesByMinX"]).toHaveLength(0)
  expect(merger["activeNodesInX"]).toHaveLength(0)
  expect(merger["preparedNodeBySourceKey"].size).toBe(0)
  expect(merger["xCoordinates"]).toHaveLength(0)
  expect(merger["horizontalRegionByBucket"].size).toBe(0)
  expect(merger["yPrecisionKeyByCoordinate"].size).toBe(0)
  expect(merger["outputProvenance"].groupIndexesByNodeId.size).toBe(0)
  expect(merger["outputProvenance"].sourceKeysByNodeId.size).toBe(0)

  const equivalenceInput: TopologyMergingSolverParams = {
    layerCount: 4,
    allowBlindAndBuriedVias: false,
    nodeGroups: [
      {
        groupId: "global",
        isComponent: false,
        nodes: [
          {
            capacityMeshNodeId: "g_left",
            center: { x: 2, y: 2 },
            width: 4,
            height: 4,
            layer: "top",
            availableZ: [0, 1, 2, 3],
            _containsObstacle: true,
          },
          {
            capacityMeshNodeId: "g_right",
            center: { x: 6, y: 2 },
            width: 4,
            height: 4,
            layer: "top",
            availableZ: [0, 1, 2, 3],
          },
        ],
      },
      {
        groupId: "component-0",
        isComponent: true,
        nodes: [
          {
            capacityMeshNodeId: "c_l_top",
            center: { x: 1, y: 3 },
            width: 2,
            height: 2,
            layer: "top",
            availableZ: [0],
            _containsObstacle: true,
          },
          {
            capacityMeshNodeId: "c_l_bottom",
            center: { x: 2, y: 1 },
            width: 4,
            height: 2,
            layer: "top",
            availableZ: [0],
            _containsObstacle: true,
          },
          {
            capacityMeshNodeId: "c_target",
            center: { x: 5, y: 2 },
            width: 1,
            height: 1,
            layer: "top",
            availableZ: [0],
            _containsObstacle: true,
            _containsTarget: true,
            _targetConnectionName: "usb_dp",
          },
        ],
      },
    ],
  }
  const { preparedNodeBySourceKey } =
    prepareTopologyMergingInput(equivalenceInput)
  const stepMerger = new TopologyMergingSolver(equivalenceInput)
  stepMerger.step()
  stepMerger.step()
  const midSweepCompacted = compactClosedAtomicRegions({
    regions: [...stepMerger["atomicRegions"]],
    openRegions: new Set(stepMerger["horizontalRegionByBucket"].values()),
    preparedNodeBySourceKey,
    completedBeforeX: 4,
  })
  while (!stepMerger.solved && !stepMerger.failed) {
    stepMerger.step()
  }
  const provenance: TopologyMergingOutputProvenance = {
    groupIndexesByNodeId: new Map<string, number[]>(),
    sourceKeysByNodeId: new Map<string, string[]>(),
  }
  const fullMerger = new TopologyMergingSolver(equivalenceInput)
  fullMerger.solve()
  expect(midSweepCompacted.length).toBeLessThanOrEqual(
    fullMerger.getOutput().length + 6,
  )
  const restoredMidSweep = restoreAuthoritativeTargetRegions({
    regions: midSweepCompacted,
    preparedNodeBySourceKey,
    overruledTargetSourceKeys: new Set<string>(),
  })
  const compactedMidSweepNodes = createTopologyMergingOutputNodes({
    regions: compactTopologyMergingRegions(restoredMidSweep),
    preparedNodeBySourceKey,
    nodeGroups: equivalenceInput.nodeGroups,
    provenance,
  })
  expect(compactedMidSweepNodes.length).toBeGreaterThan(0)
  expect(stepMerger.getOutput()).toEqual(fullMerger.getOutput())
})
