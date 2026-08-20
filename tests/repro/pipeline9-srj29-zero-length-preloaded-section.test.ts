import { expect, test } from "bun:test"
import { sample011 } from "@tscircuit/dataset-srj29-ddr3-bga-pairs"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { AutoroutingPipelineSolver10_BgaFanout } from "lib/autorouter-pipelines/AutoroutingPipeline10_BgaFanout/AutoroutingPipelineSolver10_BgaFanout"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson } from "lib/types"

const FAILED_PRELOADED_SECTION_NAME =
  "DDR3_a3_i_mx6ull_main_ram_ddr3_dram_data15_fixed_27_1"
const TARGET_CONNECTION_NAME = "DDR3_a3_i_mx6ull_main_ram_ddr3_dram_data15"

test("Pipeline 9 cannot reconnect a zero-length SRJ29 fanout section", () => {
  const inputSrj = structuredClone(sample011) as SimpleRouteJson
  const pipeline = new AutoroutingPipelineSolver10_BgaFanout(inputSrj, {
    cacheProvider: null,
  })
  pipeline.solveUntilStage("autoroutingPipelineSolver")

  expect(pipeline.failed).toBe(false)
  const secondFanoutSolver = pipeline.secondBgaFanoutSolver
  if (!secondFanoutSolver) {
    throw new Error("Pipeline 10 did not create the second fanout solver")
  }
  const fannedOutSrj = secondFanoutSolver.getOutputSimpleRouteJson()

  pipeline.step()
  pipeline.step()
  const autoroutingStage = pipeline.autoroutingPipelineSolver
  if (!autoroutingStage) {
    throw new Error("Pipeline 10 did not create its autorouting stage")
  }
  const pipeline9 = autoroutingStage.autoroutingPipelineSolver
  let reconnectError: Error | undefined
  try {
    while (
      !pipeline9.failed &&
      pipeline9.getCurrentPhase() !== "lengthMatchingPostProcessingSolver"
    ) {
      pipeline9.step()
    }
  } catch (error) {
    if (!(error instanceof Error)) throw error
    reconnectError = error
  }

  expect(reconnectError?.message).toContain(
    `could not reconnect mutated preloaded segment "${FAILED_PRELOADED_SECTION_NAME}"`,
  )

  const srjWithPointPairs = pipeline9.srjWithPointPairs
  const highDensityStitchSolver = pipeline9.highDensityStitchSolver
  if (!srjWithPointPairs || !highDensityStitchSolver) {
    throw new Error("Pipeline 9 did not reach high-density route stitching")
  }
  const belongsToTargetConnection = (
    ...connectionNames: (string | undefined)[]
  ): boolean =>
    connectionNames.some(
      (connectionName) =>
        connectionName === TARGET_CONNECTION_NAME ||
        (connectionName !== undefined &&
          pipeline9.connMap.areIdsConnected(
            connectionName,
            TARGET_CONNECTION_NAME,
          )),
    )
  const targetFanoutTraces = (fannedOutSrj.traces ?? []).filter((trace) =>
    belongsToTargetConnection(trace.connection_name),
  )
  const targetAutoroutedRoutes = highDensityStitchSolver.mergedHdRoutes.filter(
    (route) =>
      belongsToTargetConnection(route.connectionName, route.rootConnectionName),
  )
  const targetOriginalSrj = {
    ...inputSrj,
    connections: inputSrj.connections.filter((connection) =>
      belongsToTargetConnection(
        connection.name,
        connection.rootConnectionName,
        ...(connection.__rootConnectionNames ?? []),
      ),
    ),
    obstacles: inputSrj.obstacles.filter((obstacle) =>
      obstacle.connectedTo.some((connectionName) =>
        belongsToTargetConnection(connectionName),
      ),
    ),
  }
  const targetPointPairSrj = {
    ...srjWithPointPairs,
    connections: srjWithPointPairs.connections.filter((connection) =>
      belongsToTargetConnection(
        connection.name,
        connection.rootConnectionName,
        ...(connection.__rootConnectionNames ?? []),
      ),
    ),
    obstacles: targetOriginalSrj.obstacles,
  }
  const materializedTargetFanoutTraces = reconnectError
    ? []
    : pipeline9
        .getUpdatedPreloadedTraces()
        .filter((trace) => belongsToTargetConnection(trace.connection_name))
  const fanoutCircuitJson = convertToCircuitJson(
    fannedOutSrj,
    targetFanoutTraces,
    {
      originalSrj: inputSrj,
      includeOriginalConnections: true,
    },
  )
  const routedCircuitJson = convertToCircuitJson(
    srjWithPointPairs,
    targetAutoroutedRoutes,
    {
      originalSrj: inputSrj,
      includeOriginalConnections: true,
    },
  ).filter(
    (element) => element.type === "pcb_trace" || element.type === "pcb_via",
  )
  const pcbSvg = convertCircuitJsonToPcbSvg(
    [...fanoutCircuitJson, ...routedCircuitJson],
    {
      backgroundColor: "#0f172a",
      matchBoardAspectRatio: true,
    },
  )

  expect(pcbSvg).toMatchSvgSnapshot(import.meta.path, { tolerance: 0.3 })

  const materializedFanoutCircuitJson = convertToCircuitJson(
    targetPointPairSrj,
    materializedTargetFanoutTraces,
    {
      originalSrj: targetOriginalSrj,
      includeOriginalConnections: true,
    },
  )
  const targetRoutedCircuitJson = convertToCircuitJson(
    targetPointPairSrj,
    targetAutoroutedRoutes,
    {
      originalSrj: targetOriginalSrj,
      includeOriginalConnections: true,
    },
  ).filter(
    (element) => element.type === "pcb_trace" || element.type === "pcb_via",
  )
  const materializedTargetNetSvg = convertCircuitJsonToPcbSvg(
    [...materializedFanoutCircuitJson, ...targetRoutedCircuitJson],
    {
      backgroundColor: "#0f172a",
      matchBoardAspectRatio: true,
    },
  )

  expect(materializedTargetNetSvg).toMatchSvgSnapshot(import.meta.path, {
    svgName: "materialized-target-net",
  })
})
