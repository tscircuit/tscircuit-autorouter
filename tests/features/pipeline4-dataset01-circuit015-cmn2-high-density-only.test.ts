import { expect, test } from "bun:test"
import * as dataset01 from "@tscircuit/autorouting-dataset-01"
import { getGlobalInMemoryCache } from "lib/cache/setupGlobalCaches"
import { AutoroutingPipelineSolver4 } from "lib/autorouter-pipelines/AutoroutingPipeline4_TinyHypergraph/AutoroutingPipelineSolver4_TinyHypergraph"
import { HighDensitySolver } from "lib/solvers/HighDensitySolver/HighDensitySolver"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import type { SimpleRouteJson } from "lib/types"
import { createSrjFromNodeWithPortPoints } from "lib/utils/createSrjFromNodeWithPortPoints"

const getNodeOrThrow = (
  nodes: NodeWithPortPoints[] | undefined,
  nodeId: string,
) => {
  const node = nodes?.find(
    (candidate) => candidate.capacityMeshNodeId === nodeId,
  )
  expect(node).toBeDefined()
  return node!
}

test("pipeline4 dataset01 circuit015 cmn_2 high-density-only routes expected port pairs", () => {
  getGlobalInMemoryCache().clearCache()

  const circuit015 = (dataset01 as Record<string, unknown>)
    .circuit015 as SimpleRouteJson
  const pipeline = new AutoroutingPipelineSolver4(structuredClone(circuit015))

  pipeline.solveUntilPhase("highDensityRepairSolver")

  expect(pipeline.highDensityRouteSolver?.solved).toBe(true)
  expect(pipeline.highDensityRouteSolver?.failed).toBe(false)

  const cmn2Input = getNodeOrThrow(pipeline.highDensityNodePortPoints, "cmn_2")

  getGlobalInMemoryCache().clearCache()

  const solver = new HighDensitySolver({
    nodePortPoints: [structuredClone(cmn2Input)],
    colorMap: pipeline.colorMap,
    connMap: pipeline.connMap,
    viaDiameter: pipeline.viaDiameter,
    traceWidth: pipeline.minTraceWidth,
    obstacleMargin: circuit015.defaultObstacleMargin ?? 0.15,
    effort: pipeline.effort,
    nodePfById: pipeline.highDensityRouteSolver?.nodePfById,
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)

  const nodeSrj = createSrjFromNodeWithPortPoints(cmn2Input)
  const circuitJson = convertToCircuitJson(nodeSrj, solver.routes, {
    minTraceWidth: circuit015.minTraceWidth,
  })
  const { locationAwareErrors } = getDrcErrors(circuitJson)
  const accidentalContacts = locationAwareErrors.filter((error) =>
    error.message.includes("accidental contact"),
  )
  const expectedEndpointKeysByConnectionName = new Map(
    cmn2Input.portPoints.map((portPoint) => [
      portPoint.connectionName,
      cmn2Input.portPoints
        .filter(
          (candidate) => candidate.connectionName === portPoint.connectionName,
        )
        .map((candidate) => `${candidate.x}:${candidate.y}:${candidate.z}`)
        .sort(),
    ]),
  )

  expect(accidentalContacts).toHaveLength(0)
  expect(solver.routes).toHaveLength(expectedEndpointKeysByConnectionName.size)

  for (const route of solver.routes) {
    expect(route.route.length).toBeGreaterThan(1)
    const lastPoint = route.route.at(-1)
    const expectedEndpointKeys = expectedEndpointKeysByConnectionName.get(
      route.connectionName,
    )
    expect(lastPoint).toBeDefined()
    expect(expectedEndpointKeys).toHaveLength(2)
    const actualEndpointKeys = [
      `${route.route[0].x}:${route.route[0].y}:${route.route[0].z}`,
      `${lastPoint!.x}:${lastPoint!.y}:${lastPoint!.z}`,
    ].sort()

    expect(actualEndpointKeys[0]).not.toBe(actualEndpointKeys[1])
    expect(actualEndpointKeys).toEqual(expectedEndpointKeys)
  }
})
