import { expect, test } from "bun:test"
import * as dataset01 from "@tscircuit/autorouting-dataset-01"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { AvailableSegmentPointSolver } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import { NodeDimensionSubdivisionSolver } from "lib/solvers/NodeDimensionSubdivisionSolver/NodeDimensionSubdivisionSolver"
import type { CapacityMeshNode, SimpleRouteJson } from "lib/types"

function node(overrides: Partial<CapacityMeshNode> = {}): CapacityMeshNode {
  return {
    capacityMeshNodeId: "strip", center: { x: 178.16424108, y: 132.330578 },
    width: 0.00636016, height: 6.50086, availableZ: [7], layer: "z7",
    ...overrides,
  }
}

test("optional free-span floor preserves ordinary gates, dimensions, roles and default ratio behavior", (): void => {
  for (const traceWidth of [0.1, 0.1524]) {
    const minimumSpan = 1.5 * (traceWidth + 0.15)
    const expectedCount = traceWidth === 0.1 ? 17 : 14
    for (const dimension of [3, 15]) {
      const input = [node()]
      const snapshot = structuredClone(input)
      const solver = new NodeDimensionSubdivisionSolver(input, dimension, 6, 0.01, minimumSpan)
      solver.solve()
      expect(solver.outputNodes).toHaveLength(expectedCount)
      expect(solver.outputNodes.every((n) => n.width <= dimension && n.height <= dimension && n.height > minimumSpan)).toBe(true)
      expect(solver.outputNodes.reduce((sum, n) => sum + n.width * n.height, 0)).toBeCloseTo(input[0]!.width * input[0]!.height, 12)
      expect(input).toEqual(snapshot)
      const first = solver.outputNodes[0]!
      const side = node({ capacityMeshNodeId: "side", center: { x: first.center.x - first.width / 2 - 0.5, y: first.center.y }, width: 1 })
      const end = node({ capacityMeshNodeId: "end", center: { x: first.center.x, y: first.center.y - first.height / 2 - 0.5 }, width: 1, height: 1 })
      for (const [index, neighbor] of [side, end].entries()) {
        const ports = new AvailableSegmentPointSolver({ nodes: [first, neighbor], edges: [{ capacityMeshEdgeId: "gate", nodeIds: [first.capacityMeshNodeId, neighbor.capacityMeshNodeId] }], traceWidth, obstacleMargin: 0.15, shouldReturnCrampedPortPoints: true })
        ports.solve()
        const points = ports.getOutput().flatMap((s) => s.portPoints)
        expect(points.length).toBeGreaterThan(0)
        expect(points.every((p) => p.cramped)).toBe(index === 1)
      }
    }
  }
  const original = new NodeDimensionSubdivisionSolver([node()], 15, 6)
  original.solve()
  expect(original.outputNodes).toHaveLength(171)
  for (const disabledSpan of [0, -1, Infinity, NaN]) {
    const solver = new NodeDimensionSubdivisionSolver([node()], 15, 6, 0.01, disabledSpan)
    solver.solve()
    expect(solver.outputNodes).toEqual(original.outputNodes)
  }
  for (const role of [{ _containsObstacle: true }, { _containsTarget: true }, { _isNarrowQfpPadGap: true }, { _isComponentTopologyNode: true }, { _connectedTo: ["net"] }, { _targetConnectionName: "net" }, { _qfpRegionType: "pad-gap" }, { _soicRegionType: "pad-gap" }, { _parent: node() }, { unknownRole: false }, { availableZ: [0, 7] }]) {
    const solver = new NodeDimensionSubdivisionSolver([node(role as Partial<CapacityMeshNode>)], 15, 6, 0.01, 0.375)
    solver.solve()
    expect(solver.outputNodes).toHaveLength(171)
  }
  const exactFloor = new NodeDimensionSubdivisionSolver([node({ height: 0.75 })], 15, 6, 0.001, 0.375)
  exactFloor.solve()
  expect(exactFloor.outputNodes).toHaveLength(1)
  const mandatorySize = new NodeDimensionSubdivisionSolver([node({ width: 1, height: 1 })], 0.2, 6, 0.01, 0.375)
  mandatorySize.solve()
  expect(mandatorySize.outputNodes).toHaveLength(25)
  expect(mandatorySize.outputNodes.every((n) => n.width <= 0.2 && n.height <= 0.2)).toBe(true)
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(structuredClone((dataset01 as Record<string, unknown>).circuit011 as SimpleRouteJson), { cacheProvider: null })
  pipeline.solveUntilPhase("edgeSolver")
  expect(pipeline.nodeDimensionSubdivisionSolver!.stats.minimumFreeNodeSpan).toBe(1.5 * (pipeline.minTraceWidth + 0.15))
  expect(pipeline.capacityNodes).toBe(pipeline.nodeDimensionSubdivisionSolver!.outputNodes)
})
