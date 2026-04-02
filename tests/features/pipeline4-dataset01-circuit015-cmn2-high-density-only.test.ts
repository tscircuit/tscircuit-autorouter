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

test("pipeline4 dataset01 circuit015 cmn_2 high-density-only snapshot", () => {
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
  const circuitJson = convertToCircuitJson(
    nodeSrj,
    solver.routes,
    circuit015.minTraceWidth,
  )
  const { locationAwareErrors } = getDrcErrors(circuitJson)
  const accidentalContacts = locationAwareErrors.filter((error) =>
    error.message.includes("accidental contact"),
  )

  expect(accidentalContacts).toHaveLength(0)
  expect(solver.visualize()).toMatchGraphicsSvg(import.meta.path)
}, 120_000)
