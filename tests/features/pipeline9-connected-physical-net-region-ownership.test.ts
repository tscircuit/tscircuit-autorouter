import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"
import type { TinyHyperGraphSolver } from "tiny-hypergraph/lib/index"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { hasPreloadedTraceSectionMetadata } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/serializePreloadedTraceAssignments"

test("fully connected forests retain static pad ownership while user traces retain initial reroutable copper assignments", () => {
  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    obstacles: [],
    connections: [
      { name: "forest", pointsToConnect: [
        { x: -3, y: 1, layer: "top", pointId: "forest-a" },
        { x: 0, y: 1, layer: "top", pointId: "forest-b" },
        { x: 3, y: 1, layer: "top", pointId: "forest-c" },
      ] },
      { name: "user-net", pointsToConnect: [
        { x: -3, y: -3, layer: "bottom", pointId: "user-a" },
        { x: 0, y: -3, layer: "bottom", pointId: "user-b" },
        { x: 3, y: -3, layer: "bottom", pointId: "user-c" },
      ] },
      { name: "remaining", pointsToConnect: [
        { x: -2, y: -1, layer: "top", pointId: "remaining-a" },
        { x: 2, y: -1, layer: "top", pointId: "remaining-b" },
      ] },
    ],
    traces: [{
      type: "pcb_trace", pcb_trace_id: "user-trace", connection_name: "user-net",
      connectsTo: ["user-a", "user-b", "user-c"],
      route: [
        { route_type: "wire", x: -3, y: -3, width: 0.1, layer: "bottom" },
        { route_type: "wire", x: 3, y: -3, width: 0.1, layer: "bottom" },
      ],
    }],
  }
  for (const connection of input.connections) {
    for (const point of connection.pointsToConnect) {
      point.pcb_port_id = `pcb_port_${point.pointId}`
      input.obstacles.push({
        type: "rect", center: { x: point.x, y: point.y }, width: 0.5, height: 0.5,
        layers: [point.layer!], connectedTo: [connection.name, point.pcb_port_id],
        circuitJsonMetadata: {
          pcb_port_id: point.pcb_port_id, pcb_smtpad_id: `pad_${point.pointId}`,
        },
      })
    }
  }
  const original = structuredClone(input)
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, { cacheProvider: null })
  while (pipeline.getCurrentPhase() !== "portPointPathingSolver" && !pipeline.failed && !pipeline.solved) pipeline.step()
  expect(pipeline.failed).toBe(false)
  expect(pipeline.getCurrentPhase()).toBe("portPointPathingSolver")
  expect(pipeline.srjWithPointPairs!.connections.map((connection) => connection.name)).toEqual(["remaining"])
  expect(pipeline.physicalNetForestSolver!.branches).toHaveLength(2)
  pipeline.step()
  const tinyPipeline = (pipeline.portPointPathingSolver as unknown as {
    tinyPipelineSolver: { getInitialVisualizationSolver: () => TinyHyperGraphSolver; inputProblem: { serializedHyperGraph: SerializedHyperGraph } }
  }).tinyPipelineSolver
  const tiny = tinyPipeline.getInitialVisualizationSolver()
  for (const traceId of ["user-trace"]) {
    const assignments = tiny.problem.initialAssignments!.filter((assignment) =>
      tiny.problem.routeMetadata![assignment.routeId]!.preloadedTraceSection?.traceId === traceId,
    )
    expect(assignments.length).toBeGreaterThan(0)
    for (const assignment of assignments) {
      const netId = tiny.problem.routeNet[assignment.routeId]!
      for (const portId of [assignment.fromPortId, assignment.toPortId]) {
        expect(tiny.state.portAssignment[portId]).toBe(netId)
        const ownedObstacleRegions = tiny.topology.incidentPortRegion[portId]!.filter((regionId) =>
          tiny.topology.regionMetadata![regionId]!._containsObstacle === true,
        )
        for (const regionId of ownedObstacleRegions) expect(tiny.problem.regionNetId[regionId]).toBe(netId)
      }
    }
  }
  const serialized = tinyPipeline.inputProblem.serializedHyperGraph
  for (const trace of pipeline.physicalNetForestSolver!.branches) {
    expect(serialized.connections!.some((connection) => hasPreloadedTraceSectionMetadata(connection) && connection.preloadedTraceSection.traceId === trace.pcb_trace_id)).toBe(false)
    const fixedPorts = serialized.ports.filter((port) => port.d?._preloadedTracePortAssignments?.some((assignment: { traceId: string }) => assignment.traceId === trace.pcb_trace_id))
    expect(fixedPorts.length).toBeGreaterThan(0)
    for (const fixedPort of fixedPorts) {
      const portId = tiny.topology.portMetadata!.findIndex((metadata) => metadata.serializedPortId === fixedPort.portId)
      expect(portId).toBeGreaterThanOrEqual(0)
      expect(tiny.problem.portNetId![portId]).toBe(-2)
      for (const regionId of tiny.topology.incidentPortRegion[portId]!) {
        if (tiny.topology.regionMetadata![regionId]!._containsObstacle) expect(tiny.problem.regionNetId[regionId]).toBeGreaterThanOrEqual(0)
      }
    }
  }
  const initialSegments = structuredClone(tiny.state.regionSegments)
  tiny.resetRoutingStateForRerip()
  expect(tiny.state.regionSegments).toEqual(initialSegments)
  expect(input).toEqual(original)
})
