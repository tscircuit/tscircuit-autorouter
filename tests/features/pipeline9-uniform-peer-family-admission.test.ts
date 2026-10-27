import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph as Pipeline9 } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import { UniformPortDistributionSolver } from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import type { CapacityMeshNode, SimpleRouteJson } from "lib/types"
import type { SharedEdgeSegment } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"

test("P9 Uniform admits a corner family against previously accepted Native peer movements", () => {
  const srj: SimpleRouteJson = {
    layerCount: 2, allowBlindAndBuriedVias: false, minTraceWidth: 0.1,
    bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 }, obstacles: [],
    connections: [
      { name: "a", pointsToConnect: [{ x: -0.5, y: 0.19, layer: "top", pcb_port_id: "a-start" },
        { x: 0.05, y: 0.9, layer: "top", pcb_port_id: "a-end" }] },
      { name: "b", pointsToConnect: [{ x: 0.19, y: -0.5, layer: "top", pcb_port_id: "b-start" },
        { x: 0.9, y: 0.05, layer: "top", pcb_port_id: "b-end" }] },
    ],
  }
  const nodes: CapacityMeshNode[] = [
    { capacityMeshNodeId: "center", center: { x: 0.5, y: 0.5 }, width: 1, height: 1, availableZ: [0], layer: "top" },
    { capacityMeshNodeId: "left", center: { x: -0.5, y: 0.1 }, width: 1, height: 0.2, availableZ: [0], layer: "top" },
    { capacityMeshNodeId: "bottom", center: { x: 0.1, y: -0.5 }, width: 0.2, height: 1, availableZ: [0], layer: "top" },
  ]
  const edges: SharedEdgeSegment[] = [
    { edgeId: "a-edge", nodeIds: ["left", "center"], start: { x: 0, y: 0 }, end: { x: 0, y: 0.2 }, availableZ: [0],
      portPoints: [{ segmentPortPointId: "a-crossing", x: 0, y: 0.19, availableZ: [0], nodeIds: ["left", "center"],
        edgeId: "a-edge", connectionName: null, distToCentermostPortOnZ: 0.09, cramped: false }] },
    { edgeId: "b-edge", nodeIds: ["bottom", "center"], start: { x: 0, y: 0 }, end: { x: 0.2, y: 0 }, availableZ: [0],
      portPoints: [{ segmentPortPointId: "b-crossing", x: 0.19, y: 0, availableZ: [0], nodeIds: ["bottom", "center"],
        edgeId: "b-edge", connectionName: null, distToCentermostPortOnZ: 0.09, cramped: false }] },
  ]
  const before = JSON.stringify({ srj, nodes, edges })
  const pipeline = new Pipeline9(srj)
  pipeline.connMap = new ConnectivityMap({ owner0: ["a", "a-start", "a-end"], owner1: ["b", "b-start", "b-end"] })
  pipeline.srjWithPointPairs = srj
  pipeline.capacityNodes = nodes
  pipeline.sharedEdgeSegmentsWithNecessaryCrampedPortPoints = edges
  const pathingStage = pipeline.pipelineDef.find((stage) => stage.solverName === "portPointPathingSolver")!
  const pathing = new TinyHypergraphPortPointPathingSolver(
    ...pathingStage.getConstructorParams(pipeline) as ConstructorParameters<typeof TinyHypergraphPortPointPathingSolver>,
  )
  pipeline.portPointPathingSolver = pathing
  pathing.solve()
  expect(pathing.solved).toBe(true)
  expect(pathing.failed).toBe(false)
  const native = pathing.getOutput()
  const original = native.nodesWithPortPoints.find((node) => node.capacityMeshNodeId === "center")!.portPoints
    .filter((point) => point.portPointId?.includes("crossing")).sort((a, b) => a.connectionName.localeCompare(b.connectionName))
  expect(original.map((point) => [point.x, point.y])).toEqual([[0, 0.19], [0.19, 0]])
  const uniformStage = pipeline.pipelineDef.find((stage) => stage.solverName === "uniformPortDistributionSolver")!
  const [params] = uniformStage.getConstructorParams(pipeline) as ConstructorParameters<typeof UniformPortDistributionSolver>
  expect(typeof params.admitPortPointFamily).toBe("function")
  const legacy = new UniformPortDistributionSolver({ ...params, admitPortPointFamily: undefined })
  legacy.solve()
  const old = legacy.getOutput().find((node) => node.capacityMeshNodeId === "center")!.portPoints
    .filter((point) => point.portPointId?.includes("crossing")).sort((a, b) => a.connectionName.localeCompare(b.connectionName))
  expect(old.map((point) => [point.x, point.y])).toEqual([[0, 0.1], [0.1, 0]])
  const uniform = new UniformPortDistributionSolver(params)
  uniform.solve()
  expect(uniform.solved).toBe(true)
  const output = uniform.getOutput().find((node) => node.capacityMeshNodeId === "center")!.portPoints
    .filter((point) => point.portPointId?.includes("crossing")).sort((a, b) => a.connectionName.localeCompare(b.connectionName))
  expect(output.map((point) => [point.x, point.y])).toEqual([[0, 0.1], [0.19, 0]])
  expect(Math.hypot(output[0]!.x - output[1]!.x, output[0]!.y - output[1]!.y)).toBeGreaterThanOrEqual(0.2)
  // Both moves cleared the other original point. Only an index updated after
  // the accepted first family can reject the second corner move.
  expect(Math.hypot(old[0]!.x - original[1]!.x, old[0]!.y - original[1]!.y)).toBeGreaterThanOrEqual(0.2)
  expect(Math.hypot(old[1]!.x - original[0]!.x, old[1]!.y - original[0]!.y)).toBeGreaterThanOrEqual(0.2)
  const zero = new Pipeline9({ ...srj, minTraceToPadEdgeClearance: 0 })
  zero.connMap = pipeline.connMap
  zero.portPointPathingSolver = pathing
  const zeroUniform = new UniformPortDistributionSolver(
    ...uniformStage.getConstructorParams(zero) as ConstructorParameters<typeof UniformPortDistributionSolver>,
  )
  zeroUniform.solve()
  const zeroOutput = zeroUniform.getOutput().find((node) => node.capacityMeshNodeId === "center")!.portPoints
    .filter((point) => point.portPointId?.includes("crossing")).sort((a, b) => a.connectionName.localeCompare(b.connectionName))
  expect(zeroOutput.map((point) => [point.x, point.y])).toEqual([[0, 0.1], [0.1, 0]])
  const larger = new Pipeline9({ ...srj, minTraceToPadEdgeClearance: 0.3 })
  larger.connMap = pipeline.connMap
  larger.portPointPathingSolver = pathing
  expect(() => uniformStage.getConstructorParams(larger)).toThrow("Original used port")
  expect(JSON.stringify({ srj, nodes, edges })).toBe(before)
})
