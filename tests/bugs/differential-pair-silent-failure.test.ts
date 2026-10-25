import { expect, test } from "bun:test"
import { PostProcessingSolver } from "@tscircuit/length-matching-solver"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { LengthMatchingPostProcessingSolver } from "../../lib/solvers/length-matching-post-processing-solver"
import type { SimpleRouteJson } from "../../lib/types"
import { getGraphicsSvgFrames } from "../fixtures/solver-svg-frames"

type LengthMatchingStep = Extract<
  AutoroutingPipelineSolver9_PreloadedTraceGraph["pipelineDef"][number],
  { solverClass: typeof LengthMatchingPostProcessingSolver }
>

test("Pipeline9 reports rejected differential-pair post-processing", async (): Promise<void> => {
  const input: SimpleRouteJson = await Bun.file(
    new URL(
      "../../fixtures/bug-reports/differential-pair-silent-failure/differential-pair-silent-failure.srj.json",
      import.meta.url,
    ),
  ).json()
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })

  solver.solve()

  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
  expect(solver.error).toContain("source_trace_0/source_trace_1")
  expect(solver.error).toContain("could not be improved")
  const postProcessingStep = solver.pipelineDef.find(
    (step): step is LengthMatchingStep =>
      step.solverClass === LengthMatchingPostProcessingSolver,
  )
  if (!postProcessingStep)
    throw new Error("Pipeline9 has no length-matching post-processing stage")
  const producer = new PostProcessingSolver(
    postProcessingStep.getConstructorParams(solver)[0],
  )
  producer.solve()
  expect(producer.getOutput().postProcessingErrors).toMatchObject([
    {
      reason: "no-valid-candidate",
      connectionNames: ["source_trace_0", "source_trace_1"],
    },
  ])
  const postProcessingSolver = solver.lengthMatchingPostProcessingSolver
  if (!postProcessingSolver)
    throw new Error("Pipeline9 did not reach differential-pair post-processing")
  await expect(
    getGraphicsSvgFrames({
      frames: [
        {
          name: `solved=${solver.solved}, failed=${solver.failed}`,
          step: "end",
          graphics: postProcessingSolver.visualize(),
        },
      ],
      backgroundColor: "white",
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
