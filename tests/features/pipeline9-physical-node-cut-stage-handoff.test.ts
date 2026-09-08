import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { CapacityMeshNode, SimpleRouteJson } from "lib/types"

test("Pipeline9 hands real physical subdivision cuts to available ports without changing source anchors", (): void => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    minTraceToPadEdgeClearance: 0.05,
    bounds: { minX: -4, maxX: 4, minY: -6, maxY: 6 },
    obstacles: [
      {
        obstacleId: "foreign-bottom-pad",
        type: "rect",
        center: { x: 1.5, y: 0 },
        width: 1,
        height: 2,
        layers: ["bottom"],
        connectedTo: ["foreign-net"],
      },
    ],
    connections: [
      {
        name: "route-a",
        pointsToConnect: [
          { x: -3, y: -5, layer: "top", pcb_port_id: "port-a" },
          { x: 3, y: 5, layer: "bottom", pcb_port_id: "port-b" },
        ],
      },
    ],
  }
  const capacityNodes: CapacityMeshNode[] = [
    {
      capacityMeshNodeId: "central-routing-node",
      center: { x: 0, y: 0 },
      width: 2,
      height: 8,
      layer: "z0,1",
      availableZ: [0, 1],
    },
    {
      capacityMeshNodeId: "outer-start-anchor",
      center: { x: -3, y: -5 },
      width: 1,
      height: 1,
      layer: "top",
      availableZ: [0],
      _containsTarget: true,
      _targetConnectionName: "route-a",
    },
    {
      capacityMeshNodeId: "outer-end-anchor",
      center: { x: 3, y: 5 },
      width: 1,
      height: 1,
      layer: "bottom",
      availableZ: [1],
      _containsTarget: true,
      _targetConnectionName: "route-a",
    },
  ]
  const srjBefore = structuredClone(srj)
  const nodesBefore = structuredClone(capacityNodes)
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
    cacheProvider: null,
  })
  const originalSrjBefore = structuredClone(pipeline.originalSrj)
  pipeline.capacityNodes = capacityNodes
  pipeline.srjWithPointPairs = structuredClone(srj)
  const routingSrjBefore = structuredClone(pipeline.srjWithPointPairs)
  const dimensionIndex = pipeline.pipelineDef.findIndex(
    (step): boolean => step.solverName === "nodeDimensionSubdivisionSolver",
  )
  const necessaryIndex = pipeline.pipelineDef.findIndex(
    (step): boolean => step.solverName === "necessaryCrampedPortPointSolver",
  )
  expect(dimensionIndex).toBeGreaterThanOrEqual(0)
  expect(necessaryIndex).toBeGreaterThan(dimensionIndex)
  pipeline.currentPipelineStepIndex = dimensionIndex
  while (
    !pipeline.failed &&
    !pipeline.solved &&
    pipeline.currentPipelineStepIndex < necessaryIndex
  ) {
    pipeline.step()
  }

  expect(pipeline.failed).toBeFalse()
  expect(pipeline.solved).toBeFalse()
  expect(pipeline.error).toBeNull()
  expect(pipeline.currentPipelineStepIndex).toBe(necessaryIndex)
  expect(pipeline.necessaryCrampedPortPointSolver).toBeUndefined()
  expect(pipeline.portPointPathingSolver).toBeUndefined()
  expect(pipeline.nodeDimensionSubdivisionSolver?.solved).toBeTrue()
  expect(pipeline.edgeSolver?.solved).toBeTrue()
  expect(pipeline.availableSegmentPointSolver?.solved).toBeTrue()
  const dimension = pipeline.nodeDimensionSubdivisionSolver!
  const available = pipeline.availableSegmentPointSolver!
  expect(dimension.outputPhysicalCuts).toHaveLength(3)
  expect(dimension.outputNodes).toHaveLength(6)
  expect(pipeline.capacityNodes).toBe(dimension.outputNodes)
  expect(pipeline.capacityEdges).toBe(pipeline.edgeSolver!.edges)
  expect(available.getOutput()).toHaveLength(3)
  const cutCoordinates: number[] = []
  for (const cut of dimension.outputPhysicalCuts) {
    const matchingEdges = pipeline.capacityEdges!.filter(
      (edge): boolean =>
        cut.nodeIds.every((nodeId): boolean => edge.nodeIds.includes(nodeId)),
    )
    expect(matchingEdges).toHaveLength(1)
    const segments = available.getOutput().filter(
      (segment): boolean => segment.edgeId === matchingEdges[0]!.capacityMeshEdgeId,
    )
    expect(segments).toHaveLength(1)
    const segment = segments[0]!
    expect(segment.nodeIds).toEqual(matchingEdges[0]!.nodeIds)
    expect(segment.start.x).toBe(-1)
    expect(segment.end.x).toBe(1)
    expect(segment.start.y).toBe(segment.end.y)
    expect(segment.availableZ).toEqual([0, 1])
    cutCoordinates.push(segment.start.y)
    expect(segment.portPoints).toHaveLength(17)
    for (const z of [0, 1]) {
      const ports = segment.portPoints.filter(
        (port): boolean => port.availableZ[0] === z,
      )
      expect(ports.map((port): number => port.x)).toEqual(
        z === 0
          ? [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1]
          : [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75],
      )
      for (const port of ports) {
        expect(port.y).toBe(segment.start.y)
        expect(port.availableZ).toEqual([z])
        expect(port.nodeIds).toEqual(segment.nodeIds)
        expect(port.physicalCutId).toBe(cut.physicalCutId)
        expect(port.cramped).toBeFalse()
        expect(available.portPointMap.get(port.segmentPortPointId)).toBe(port)
      }
    }
  }
  expect(cutCoordinates.sort((left, right): number => left - right)).toEqual([
    -1, 0, 1,
  ])
  for (const anchor of capacityNodes.slice(1)) {
    expect(
      pipeline.capacityNodes!.find(
        (node): boolean => node.capacityMeshNodeId === anchor.capacityMeshNodeId,
      ),
    ).toBe(anchor)
  }
  expect(capacityNodes).toEqual(nodesBefore)
  expect(srj).toEqual(srjBefore)
  expect(pipeline.originalSrj).toEqual(originalSrjBefore)
  expect(pipeline.srjWithPointPairs).toEqual(routingSrjBefore)
})
