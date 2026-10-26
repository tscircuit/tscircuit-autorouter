import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { createPipeline9StaticSegmentValidator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9StaticSegmentValidator"
import type { InputNodeWithPortPoints } from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import {
  UniformPortDistributionSolver,
  type UniformPortDistributionSolverInput,
} from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import type { SimpleRouteJson } from "lib/types"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import bugReport from "../../fixtures/bug-reports/bugreport107-board-1726/bugreport107-board-1726.json" with {
  type: "json",
}

test("Pipeline 9 places initial shared ports at its actual routing width before nominal-width expansion", (): void => {
  const srj = structuredClone(bugReport.simple_route_json) as SimpleRouteJson
  const ownerNodeIds: [string, string] = [
    "cmn_71",
    "new-cmn_2554-1839",
  ]
  const port = {
    portPointId: "ce2312_pp0_z0::0",
    connectionName: "source_net_148",
    rootConnectionName: "source_net_148",
    x: -20,
    y: -14.399999999999999,
    z: 0,
  }
  const nodes: (NodeWithPortPoints & { availableZ: number[] })[] = [
    {
      capacityMeshNodeId: ownerNodeIds[0]!,
      center: { x: -20.487499999999997, y: -13.849999999999998 },
      width: 3.5749999999999993,
      height: 1.0999999999999996,
      availableZ: [0, 1, 2, 3],
      portPoints: [{ ...port }],
    },
    {
      capacityMeshNodeId: ownerNodeIds[1]!,
      center: { x: -20, y: -14.549999999999999 },
      width: 0.6000000000000014,
      height: 0.3000000000000007,
      availableZ: [0],
      portPoints: [{ ...port }],
    },
  ]
  const inputNodes: InputNodeWithPortPoints[] = nodes.map((node) => ({
    ...node,
    portPoints: node.portPoints.map((point) => ({
      ...point,
      portPointId: point.portPointId!,
      connectionNodeIds: ownerNodeIds,
      distToCentermostPortOnZ: 0,
    })),
  }))
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
    cacheProvider: null,
  })
  pipeline.portPointPathingSolver = {
    getOutput: () => ({
      nodesWithPortPoints: nodes,
      inputNodeWithPortPoints: inputNodes,
    }),
    computeNodePfMap: () => new Map(),
  } as unknown as NonNullable<typeof pipeline.portPointPathingSolver>
  const stage = pipeline.pipelineDef.find(
    (step) => step.solverName === "uniformPortDistributionSolver",
  )!
  const [params] = stage.getConstructorParams(pipeline) as [
    UniformPortDistributionSolverInput,
  ]
  const uniform = new UniformPortDistributionSolver(params)
  expect(() => uniform.solve()).not.toThrow()
  expect(uniform.solved).toBe(true)
  expect(params.routingTraceWidth).toBe(0.095)
  const point = uniform.getOutput()[0]!.portPoints[0]!
  expect(point).toEqual(port)
  pipeline.uniformPortDistributionSolver = uniform
  const hdStage = pipeline.pipelineDef.find(
    (step) => step.solverName === "highDensityRouteSolver",
  )!
  const [hdParams] = hdStage.getConstructorParams(pipeline) as [
    { traceWidth: number },
  ]
  expect(hdParams.traceWidth).toBe(params.routingTraceWidth!)
  const nominalConnection = srj.connections.find(
    (connection) => connection.name === port.connectionName,
  )!
  expect(nominalConnection.nominalTraceWidth).toBe(1.5)
  expect(nominalConnection.width).toBe(1.5)
  const validate = createPipeline9StaticSegmentValidator(srj)
  expect(
    validate({
      connectionName: port.connectionName,
      start: point,
      end: point,
      traceThickness: hdParams.traceWidth,
      viaDiameter: 0.3,
    }),
  ).toBe(true)
  expect(
    validate({
      connectionName: port.connectionName,
      start: point,
      end: point,
      traceThickness: nominalConnection.nominalTraceWidth!,
      viaDiameter: 0.3,
    }),
  ).toBe(false)
  const variableWidth = new UniformPortDistributionSolver({
    ...params,
    routingTraceWidth: undefined,
  })
  expect(() => variableWidth.solve()).toThrow(
    'No owner-clear ordered placement on shared edge "cmn_71|new-cmn_2554-1839"',
  )
  expect(
    () => new UniformPortDistributionSolver({ ...params, routingTraceWidth: 0 }),
  ).toThrow("Invalid physical routing trace width")
})
