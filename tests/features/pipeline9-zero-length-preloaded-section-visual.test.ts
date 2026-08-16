import { sample011 } from "@tscircuit/dataset-srj29-ddr3-bga-pairs"
import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver10_BgaFanout } from "lib/autorouter-pipelines/AutoroutingPipeline10_BgaFanout/AutoroutingPipelineSolver10_BgaFanout"
import type { SimpleRouteJson } from "lib/types"
import { getDdr3PipelinePcbSvg } from "tests/fixtures/getDdr3PipelinePcbSvg"

test("visual repro: a zero-length fixed section prevents reconnecting a real fanout trace", async () => {
  const inputSrj = structuredClone(sample011) as SimpleRouteJson
  const pipeline = new AutoroutingPipelineSolver10_BgaFanout(inputSrj)
  pipeline.solveUntilStage("autoroutingPipelineSolver")

  expect(pipeline.failed).toBeFalse()
  const fannedOutSrj =
    pipeline.secondBgaFanoutSolver!.getOutputSimpleRouteJson()

  pipeline.step()
  pipeline.step()
  const autorouter =
    pipeline.autoroutingPipelineSolver!.autoroutingPipelineSolver
  let repairError: unknown
  try {
    while (
      !autorouter.failed &&
      autorouter.getCurrentPhase() !== "lengthMatchingPostProcessingSolver"
    ) {
      autorouter.step()
    }
  } catch (error) {
    repairError = error
  }

  expect(repairError).toBeInstanceOf(Error)
  expect((repairError as Error).message).toContain(
    'could not reconnect mutated preloaded segment "DDR3_a3_i_mx6ull_main_ram_ddr3_dram_data15_fixed_27_1"',
  )

  await expect(
    getDdr3PipelinePcbSvg({
      originalSrj: inputSrj,
      fannedOutSrj,
      autorouterSrj: autorouter.srjWithPointPairs!,
      autoroutedRoutes: autorouter.highDensityStitchSolver!.mergedHdRoutes,
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
