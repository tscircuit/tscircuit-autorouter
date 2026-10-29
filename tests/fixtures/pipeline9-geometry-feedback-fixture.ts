import type { CapacityMeshNode, SimpleRouteJson } from "lib/types"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import type { SharedEdgeSegment } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import { auditPipeline9GeometryFeedback, createPipeline9GeometryFeedbackStats } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/auditPipeline9GeometryFeedback"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import { UniformPortDistributionSolver } from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import { Pipeline9GeometryFeedbackSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9GeometryFeedbackSolver"

export const createGeometryFeedbackFixture = (): {
  srj: SimpleRouteJson
  nodes: CapacityMeshNode[]
  segments: SharedEdgeSegment[]
  assignedNodes: NodeWithPortPoints[]
  stats: ReturnType<typeof createPipeline9GeometryFeedbackStats>
} => {
  const srj: SimpleRouteJson = {
    layerCount: 4, minTraceWidth: 0.1,
    bounds: { minX: -4, maxX: 4, minY: -4, maxY: 4 },
    obstacles: [], connections: [{ name: "signal", pointsToConnect: [
      { x: -1, y: 0, layer: "top" }, { x: 1, y: 0, layer: "top" },
    ] }],
  }
  const nodes = [-1, 1].map((x, index) => ({
    capacityMeshNodeId: `node_${index}`, center: { x, y: 0 },
    width: 2, height: 2, layer: "top", availableZ: [0, 1, 2, 3],
  }))
  const nodeIds: [string, string] = ["node_0", "node_1"]
  const segments: SharedEdgeSegment[] = [{
    edgeId: "shared", nodeIds, start: { x: 0, y: -1 }, end: { x: 0, y: 1 },
    availableZ: [0, 1],
    portPoints: [-0.5, 0, 0.5].map((y, index) => ({
      segmentPortPointId: `port_${index}`, x: 0, y, availableZ: [0, 1],
      nodeIds, edgeId: "shared", connectionName: null,
      distToCentermostPortOnZ: Math.abs(y), cramped: false,
    })),
  }]
  const assignedNodes = nodes.map((node) => ({
    ...node, portPoints: [{
      portPointId: "port_1::0", x: 0, y: 0, z: 0, connectionName: "signal",
    }],
  }))
  return { srj, nodes, segments, assignedNodes, stats: createPipeline9GeometryFeedbackStats() }
}

export const auditGeometryFixture = (
  fixture: ReturnType<typeof createGeometryFeedbackFixture>,
): ReturnType<typeof auditPipeline9GeometryFeedback> => auditPipeline9GeometryFeedback(fixture)

export const createGeometryFeedbackPlanningFixture = (options: {
  upperCorridor?: boolean
  secondConnection?: boolean
} = {}): {
  pipeline: AutoroutingPipelineSolver9_PreloadedTraceGraph
  feedback: Pipeline9GeometryFeedbackSolver
} => {
  const fixture = createGeometryFeedbackFixture()
  fixture.srj.connections[0]!.pointsToConnect[0]!.x = -1.5
  fixture.srj.connections[0]!.pointsToConnect[1]!.x = 1.5
  if (options.secondConnection) {
    fixture.srj.connections.push({ name: "other", pointsToConnect: [
      { x: -1.5, y: 0.4, layer: "top" }, { x: 1.5, y: 0.4, layer: "top" },
    ] })
  }
  fixture.nodes.push({
    capacityMeshNodeId: "node_2", center: { x: 0, y: 2 }, width: 4, height: 2,
    layer: "top", availableZ: [0, 1, 2, 3],
  })
  fixture.srj.obstacles = [{
    type: "rect", shape: "circle", center: { x: 0, y: 0 }, width: 2.2, height: 2.2,
    isNonPlatedHole: true, connectedTo: [], layers: ["top"],
  }]
  fixture.segments[0]!.portPoints = [fixture.segments[0]!.portPoints[1]!]
  fixture.segments[0]!.portPoints[0]!.availableZ = [0]
  for (const [index, x] of (options.upperCorridor === false ? [] : [-1, 1]).entries()) {
    const nodeIds: [string, string] = [`node_${index}`, "node_2"]
    fixture.segments.push({
      edgeId: `upper_${index}`, nodeIds, start: { x: x - 1, y: 1 },
      end: { x: x + 1, y: 1 }, availableZ: [0],
      portPoints: [{
        segmentPortPointId: `upper_port_${index}`, edgeId: `upper_${index}`,
        x, y: 1, availableZ: [0], nodeIds, connectionName: null,
        distToCentermostPortOnZ: 0, cramped: false,
      }],
    })
  }
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(fixture.srj, {
    cacheProvider: null, experimentGeometryFeedback: true,
  })
  pipeline.capacityNodes = fixture.nodes
  pipeline.srjWithPointPairs = fixture.srj
  pipeline.sharedEdgeSegmentsWithNecessaryCrampedPortPoints = fixture.segments
  const pathingStep = pipeline.pipelineDef.find((step) => step.solverName === "portPointPathingSolver")!
  const pathingParams = pathingStep.getConstructorParams(pipeline) as ConstructorParameters<typeof TinyHypergraphPortPointPathingSolver>
  pipeline.portPointPathingSolver = new TinyHypergraphPortPointPathingSolver(...pathingParams)
  pipeline.portPointPathingSolver.solve()
  const uniformStep = pipeline.pipelineDef.find((step) => step.solverName === "uniformPortDistributionSolver")!
  const uniformParams = uniformStep.getConstructorParams(pipeline) as ConstructorParameters<typeof UniformPortDistributionSolver>
  pipeline.uniformPortDistributionSolver = new UniformPortDistributionSolver(...uniformParams)
  pipeline.uniformPortDistributionSolver.solve()
  const step = pipeline.pipelineDef.find((step) => step.solverName === "geometryFeedbackSolver")!
  const feedbackParams = step.getConstructorParams(pipeline) as ConstructorParameters<typeof Pipeline9GeometryFeedbackSolver>
  const feedback = new Pipeline9GeometryFeedbackSolver(...feedbackParams)
  return { pipeline, feedback }
}
