import { expect, test } from "bun:test"
import * as dataset01 from "@tscircuit/autorouting-dataset-01"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { RELAXED_DRC_OPTIONS } from "lib/testing/drcPresets"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

const TARGET_CONNECTION = "source_net_9"
const TOLERANCE = 1e-3

const pointsMatch = (
  a: { x: number; y: number },
  b: { x: number; y: number },
) => Math.abs(a.x - b.x) < TOLERANCE && Math.abs(a.y - b.y) < TOLERANCE

const routeEndpointTouchesPoint = (
  route: HighDensityIntraNodeRoute,
  point: { x: number; y: number },
) => {
  const firstPoint = route.route[0]!
  const lastPoint = route.route[route.route.length - 1]!
  return pointsMatch(firstPoint, point) || pointsMatch(lastPoint, point)
}

test("pipeline7 dataset01 circuit107 stitch output stays open between two terminals", () => {
  const circuit107 = (dataset01 as Record<string, unknown>)
    .circuit107 as SimpleRouteJson
  const solver = new AutoroutingPipelineSolver7_MultiGraph(
    structuredClone(circuit107),
    { cacheProvider: null },
  )

  solver.solveUntilPhase("traceSimplificationSolver")

  const targetConnection = solver.srjWithPointPairs!.connections.find(
    (connection) => connection.name === TARGET_CONNECTION,
  )
  expect(targetConnection).toBeDefined()

  const stitchedRoutes =
    solver.highDensityStitchSolver?.mergedHdRoutes.filter(
      (route) => route.connectionName === TARGET_CONNECTION,
    ) ?? []
  expect(stitchedRoutes).toHaveLength(1)

  const stitchedRoute = stitchedRoutes[0]!
  const firstPoint = stitchedRoute.route[0]!
  const lastPoint = stitchedRoute.route[stitchedRoute.route.length - 1]!
  expect(pointsMatch(firstPoint, lastPoint)).toBe(false)
  expect(
    routeEndpointTouchesPoint(
      stitchedRoute,
      targetConnection!.pointsToConnect[0],
    ),
  ).toBe(true)
  expect(
    routeEndpointTouchesPoint(
      stitchedRoute,
      targetConnection!.pointsToConnect[1],
    ),
  ).toBe(true)

  solver.solve()

  const circuitJson = convertToCircuitJson(
    solver.srjWithPointPairs!,
    solver.getOutputSimplifiedPcbTraces(),
    {
      minTraceWidth: circuit107.minTraceWidth,
      originalSrj: circuit107,
    },
  )
  const { errors } = getDrcErrors(circuitJson, RELAXED_DRC_OPTIONS)

  expect(errors).toHaveLength(0)
})
