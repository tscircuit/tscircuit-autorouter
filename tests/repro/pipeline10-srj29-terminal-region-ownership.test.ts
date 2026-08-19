import { sample007 } from "@tscircuit/dataset-srj29-ddr3-bga-pairs"
import { expect, test } from "bun:test"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { AutoroutingPipelineSolver10_BgaFanout } from "lib/autorouter-pipelines/AutoroutingPipeline10_BgaFanout/AutoroutingPipelineSolver10_BgaFanout"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "lib/types"

const PATHING_ITERATION_BUDGET = 250_000

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
  const tinyPipeline = pathing.tinyPipelineSolver
  while (!tinyPipeline.getSolver("solveGraph")) pathing.step()
  const solveGraph = tinyPipeline.getSolver("solveGraph")
  if (!solveGraph) throw new Error("Tiny hypergraph solve stage was not created")
  solveGraph.MAX_ITERATIONS = PATHING_ITERATION_BUDGET
  pathing.solve()

  expect(pathing.failed).toBe(true)
  expect(pathing.error).toContain("ran out of iterations")

  const fannedOutSrj =
    pipeline.secondBgaFanoutSolver!.getOutputSimpleRouteJson()
  let detailedRoutedTraces: SimplifiedPcbTraces = []
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

    detailedRoutedTraces = convertPipeline7HdRoutesToSimplifiedPcbTraces({
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
  }

  const circuitJson = convertToCircuitJson(
    pipeline9.srjWithPointPairs ?? fannedOutSrj,
    [...(fannedOutSrj.traces ?? []), ...detailedRoutedTraces],
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
