import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph as Pipeline9 } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import { UniformPortDistributionSolver } from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import { precomputeIntraNodeRouteParams } from "lib/solvers/HighDensitySolver/precomputeIntraNodeRouteParams"
import type { CapacityMeshNode, SimpleRouteJson } from "lib/types"
import type { SharedEdgeSegment } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"

test("one MST revisits a partial cell on two layers through an outside via without an HDR phantom transition", () => {
  const srj: SimpleRouteJson = {
    layerCount: 8, allowBlindAndBuriedVias: false, minTraceWidth: 0.1,
    bounds: { minX: -3, maxX: 3, minY: -2, maxY: 2 }, obstacles: [],
    connections: [{ name: "same-mst", __rootConnectionNames: ["same-net"],
      pointsToConnect: [{ x: -1.5, y: 0, layer: "inner2", pcb_port_id: "start-pad" },
        { x: -1.5, y: 0, layer: "bottom", pcb_port_id: "end-pad" }] }],
  }
  const nodes: CapacityMeshNode[] = [
    { capacityMeshNodeId: "start", center: { x: -1.5, y: 0 }, width: 1, height: 1,
      availableZ: [2], layer: "inner2", _containsTarget: true, _connectedTo: ["same-net"] },
    { capacityMeshNodeId: "end", center: { x: -1.5, y: 0 }, width: 1, height: 1,
      availableZ: [7], layer: "bottom", _containsTarget: true, _connectedTo: ["same-net"] },
    { capacityMeshNodeId: "partial", center: { x: 0, y: 0 }, width: 2, height: 1,
      availableZ: [2, 7], layer: "inner2" },
    { capacityMeshNodeId: "outside-full-stack", center: { x: 1.5, y: 0 }, width: 1, height: 1,
      availableZ: [0, 1, 2, 3, 4, 5, 6, 7], layer: "top" },
  ]
  const edge = (id: string, nodeIds: [string, string], x: number, y: number, z: number): SharedEdgeSegment => ({
    edgeId: id, nodeIds, start: { x, y: -0.5 }, end: { x, y: 0.5 }, availableZ: [z],
    portPoints: [{ segmentPortPointId: id, x, y, availableZ: [z], nodeIds, edgeId: id,
      connectionName: null, distToCentermostPortOnZ: Math.abs(y), cramped: false }],
  })
  const pipeline = new Pipeline9(srj)
  pipeline.connMap = new ConnectivityMap({ same: ["same-mst", "same-net", "start-pad", "end-pad"] })
  pipeline.srjWithPointPairs = srj
  pipeline.capacityNodes = nodes
  pipeline.sharedEdgeSegmentsWithNecessaryCrampedPortPoints = [
    edge("start-to-partial-z2", ["start", "partial"], -1, -0.2, 2),
    edge("partial-to-outside-z2", ["partial", "outside-full-stack"], 1, -0.2, 2),
    edge("outside-to-partial-z7", ["outside-full-stack", "partial"], 1, 0.2, 7),
    edge("partial-to-end-z7", ["partial", "end"], -1, 0.2, 7),
  ]
  const before = JSON.stringify({ nodes, srj })
  const pathingStep = pipeline.pipelineDef.find((stage) => stage.solverName === "portPointPathingSolver")!
  expect(pathingStep.solverClass).toBe(TinyHypergraphPortPointPathingSolver)
  const pathing = new TinyHypergraphPortPointPathingSolver(
    ...pathingStep.getConstructorParams(pipeline) as ConstructorParameters<typeof TinyHypergraphPortPointPathingSolver>,
  )
  pipeline.portPointPathingSolver = pathing
  pathing.solve()
  expect(pathing.solved).toBe(true)
  expect(pathing.failed).toBe(false)
  const nativeOutput = pathing.getOutput()
  const inputDomains = nativeOutput.inputNodeWithPortPoints.filter((node) => node.capacityMeshNodeId.startsWith("partial::layer:"))
  expect(inputDomains.map((node) => node.capacityMeshNodeId).sort()).toEqual(["partial::layer:2", "partial::layer:7"])
  const inputIds = new Set(nativeOutput.inputNodeWithPortPoints.map((node) => node.capacityMeshNodeId))
  expect(inputDomains.every((node) => node.portPoints.every((point) => point.connectionNodeIds.every((id) => inputIds.has(id))))).toBe(true)

  const uniformStep = pipeline.pipelineDef.find((stage) => stage.solverName === "uniformPortDistributionSolver")!
  expect(uniformStep.solverClass).toBe(UniformPortDistributionSolver)
  const uniform = new UniformPortDistributionSolver(
    ...uniformStep.getConstructorParams(pipeline) as ConstructorParameters<typeof UniformPortDistributionSolver>,
  )
  pipeline.uniformPortDistributionSolver = uniform
  uniform.solve()
  expect(uniform.solved).toBe(true)
  const domains = uniform.getOutput().filter((node) => node.capacityMeshNodeId.startsWith("partial::layer:"))
  expect(domains.length).toBe(2)
  for (const domain of domains) {
    expect(domain.availableZ!.length).toBe(1)
    expect(domain.portPoints.length).toBe(2)
    const tasks = precomputeIntraNodeRouteParams(domain).connectionPointsByName
    expect(tasks.size).toBe(1)
    expect([...tasks.keys()]).toEqual(["same-mst"])
    expect([...new Set(tasks.get("same-mst")!.map((point) => point.z))]).toEqual(domain.availableZ!)
  }
  const hdrStep = pipeline.pipelineDef.find((stage) => stage.solverName === "highDensityRouteSolver")!
  expect(hdrStep.solverClass).toBe(Pipeline9HighDensitySolver)
  const hdr = new Pipeline9HighDensitySolver(
    ...hdrStep.getConstructorParams(pipeline) as ConstructorParameters<typeof Pipeline9HighDensitySolver>,
  )
  hdr.solve()
  expect(hdr.solved).toBe(true)
  expect(hdr.failed).toBe(false)
  const fragments = hdr.routes.filter((route) => route.regionId?.startsWith("partial::layer:"))
  expect(fragments.length).toBe(2)
  expect(fragments.every((route) => route.connectionName === "same-mst" && route.vias.length === 0)).toBe(true)
  expect(fragments.map((route) => [...new Set(route.route.map((point) => point.z))]).sort()).toEqual([[2], [7]])
  const outside = hdr.routes.filter((route) => route.regionId === "outside-full-stack")
  expect(outside.length).toBe(1)
  expect(outside[0]!.vias.length).toBe(1)
  expect(JSON.stringify({ nodes, srj })).toBe(before)
})
