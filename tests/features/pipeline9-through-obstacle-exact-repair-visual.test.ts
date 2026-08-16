import { sample003 } from "@tscircuit/dataset-srj29-ddr3-bga-pairs"
import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver10_BgaFanout } from "lib/autorouter-pipelines/AutoroutingPipeline10_BgaFanout/AutoroutingPipelineSolver10_BgaFanout"
import type { SimpleRouteJson } from "lib/types"
import { getDdr3PipelinePcbSvg } from "tests/fixtures/getDdr3PipelinePcbSvg"

test("visual: exact repair preserves a real through-obstacle fanout trace", async () => {
  const inputSrj = structuredClone(sample003) as SimpleRouteJson
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

  expect(repairError).toBeUndefined()
  expect(autorouter.failed).toBeFalse()
  expect(autorouter.getCurrentPhase()).toBe(
    "lengthMatchingPostProcessingSolver",
  )
  expect(autorouter.pipeline9JointDrcRepairSolver!.solved).toBeTrue()

  await expect(
    getDdr3PipelinePcbSvg({
      originalSrj: inputSrj,
      fannedOutSrj,
      autorouterSrj: autorouter.srjWithPointPairs!,
      autoroutedRoutes: autorouter.pipeline9JointDrcRepairSolver!.getOutput(),
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
