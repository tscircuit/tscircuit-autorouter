import { expect, test } from "bun:test"
import { sample007 } from "@tscircuit/dataset-srj29-ddr3-bga-pairs"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { AutoroutingPipelineSolver10_BgaFanout } from "lib/autorouter-pipelines/AutoroutingPipeline10_BgaFanout/AutoroutingPipelineSolver10_BgaFanout"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "lib/types"

const PATHING_ITERATION_BUDGET = 250_000
const TARGET_CONNECTION_NAME = "DDR3_m2_fpga_ddr_dram_ba0"

test("Pipeline 10 routes SRJ29 sample007 without reserving whole terminal regions", () => {
  const inputSrj = structuredClone(sample007) as SimpleRouteJson
  const pipeline = new AutoroutingPipelineSolver10_BgaFanout(inputSrj, {
    cacheProvider: null,
  })
  pipeline.solveUntilStage("autoroutingPipelineSolver")
  pipeline.step()

  const pipeline9 =
    pipeline.autoroutingPipelineSolver!.autoroutingPipelineSolver
  pipeline9.solveUntilPhase("portPointPathingSolver")
  pipeline9.step()

  const pathing = pipeline9.portPointPathingSolver!
  pathing.MAX_ITERATIONS = PATHING_ITERATION_BUDGET
  pathing.solve()

  expect(pathing.failed).toBe(true)
  expect(pathing.error).toContain("ran out of iterations")

  const fannedOutSrj =
    pipeline.secondBgaFanoutSolver!.getOutputSimpleRouteJson()
  let targetNetTraces = (fannedOutSrj.traces ?? []).filter(
    (trace) => trace.connection_name === TARGET_CONNECTION_NAME,
  )
  if (pathing.solved) {
    const pathingOutput = pathing.getOutput()
    pipeline9.step()
    pipeline9.solveUntilPhase("highDensityRouteSolver")
    pipeline9.step()
    const highDensityRouteSolver = pipeline9.highDensityRouteSolver
    if (!highDensityRouteSolver) {
      throw new Error("Pipeline 9 high-density route stage was not created")
    }
    highDensityRouteSolver.solve()
    if (!highDensityRouteSolver.solved) {
      throw new Error(
        highDensityRouteSolver.error ?? "High-density routing failed",
      )
    }

    const pointPairSrj = pipeline9.srjWithPointPairs
    if (!pointPairSrj) throw new Error("Pipeline 9 point pairs are missing")
    const stitchSolver = new MultipleHighDensityRouteStitchSolver3({
      connections: [
        ...pointPairSrj.connections,
        ...pathingOutput.changedPreloadedTraceSections.map(
          (section) => section.connection,
        ),
      ],
      hdRoutes: highDensityRouteSolver.routes,
      layerCount: inputSrj.layerCount,
      defaultViaDiameter: pipeline9.viaDiameter,
      preserveTerminalPcbPortIds: true,
    })
    stitchSolver.solve()
    if (!stitchSolver.solved) {
      throw new Error(stitchSolver.error ?? "Route stitching failed")
    }

    const detailedRoutedTraces: SimplifiedPcbTraces =
      convertPipeline7HdRoutesToSimplifiedPcbTraces({
        connections: pointPairSrj.connections,
        originalConnections: inputSrj.connections,
        hdRoutes: stitchSolver.mergedHdRoutes.filter(
          (route) =>
            !route.connectionName.startsWith("__tscircuit_preloaded_trace__"),
        ),
        layerCount: inputSrj.layerCount,
        obstacles: fannedOutSrj.obstacles,
        defaultViaHoleDiameter: pipeline9.viaHoleDiameter,
        connMap: pipeline9.connMap,
      })
    targetNetTraces = [
      ...(fannedOutSrj.traces ?? []),
      ...detailedRoutedTraces,
    ].filter((trace) => trace.connection_name === TARGET_CONNECTION_NAME)
  }

  expect(
    evaluateRelaxedDrc({
      inputSrj,
      srjWithPointPairs: pipeline9.srjWithPointPairs ?? fannedOutSrj,
      routedTraces: targetNetTraces,
    }).errors,
  ).toHaveLength(0)

  const circuitJson = convertToCircuitJson(
    pipeline9.srjWithPointPairs ?? fannedOutSrj,
    targetNetTraces,
    {
      minTraceWidth: inputSrj.minTraceWidth,
      minViaDiameter: inputSrj.minViaDiameter,
      originalSrj: inputSrj,
      includeOriginalConnections: true,
    },
  )
  const pcbSvg = convertCircuitJsonToPcbSvg(circuitJson, {
    backgroundColor: "#0f172a",
    matchBoardAspectRatio: true,
  })

  expect(pcbSvg).toMatchSvgSnapshot(import.meta.path)
})
