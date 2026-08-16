import { sample004 } from "@tscircuit/dataset-srj29-ddr3-bga-pairs"
import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver10_BgaFanout } from "lib/autorouter-pipelines/AutoroutingPipeline10_BgaFanout/AutoroutingPipelineSolver10_BgaFanout"
import type { SimpleRouteJson } from "lib/types"
import { getDdr3PipelinePcbSvg } from "tests/fixtures/getDdr3PipelinePcbSvg"

const affectedConnectionName =
  '__tscircuit_preloaded_trace__:["fanout:DDR3_k1_ram_odt:source-1",1]'
const affectedTraceId = "fanout:DDR3_k1_ram_odt:source-1"

test("visual: stitching keeps the via beside a real inner-layer terminal", async () => {
  const inputSrj = structuredClone(sample004) as SimpleRouteJson
  const pipeline = new AutoroutingPipelineSolver10_BgaFanout(inputSrj)
  pipeline.solveUntilStage("autoroutingPipelineSolver")

  expect(pipeline.failed).toBeFalse()
  const fannedOutSrj =
    pipeline.secondBgaFanoutSolver!.getOutputSimpleRouteJson()

  pipeline.step()
  pipeline.step()
  const autorouter =
    pipeline.autoroutingPipelineSolver!.autoroutingPipelineSolver
  while (
    !autorouter.failed &&
    autorouter.getCurrentPhase() !== "traceSimplificationSolver"
  ) {
    autorouter.step()
  }

  expect(autorouter.failed).toBeFalse()
  const affectedRoute =
    autorouter.highDensityStitchSolver!.mergedHdRoutes.find(
      (route) => route.connectionName === affectedConnectionName,
    )!
  expect(affectedRoute).toBeDefined()
  expect([
    affectedRoute.route[0]!.z,
    affectedRoute.route.at(-1)!.z,
  ]).toContain(10)
  const viaTransition = affectedRoute.route.find((point, pointIndex, route) => {
    const nextPoint = route[pointIndex + 1]
    return (
      nextPoint !== undefined &&
      point.z !== nextPoint.z &&
      Math.abs(point.x - nextPoint.x) < 1e-6 &&
      Math.abs(point.y - nextPoint.y) < 1e-6
    )
  })!
  expect(viaTransition).toBeDefined()
  expect(affectedRoute.vias).toContainEqual({
    x: viaTransition.x,
    y: viaTransition.y,
  })

  const focusedFannedOutSrj = {
    ...fannedOutSrj,
    traces: fannedOutSrj.traces?.filter(
      (trace) => trace.pcb_trace_id === affectedTraceId,
    ),
  }

  await expect(
    getDdr3PipelinePcbSvg({
      originalSrj: inputSrj,
      fannedOutSrj: focusedFannedOutSrj,
      autorouterSrj: autorouter.srjWithPointPairs!,
      autoroutedRoutes: [affectedRoute],
      focusBounds: { minX: -12, maxX: -2, minY: 1, maxY: 5 },
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
