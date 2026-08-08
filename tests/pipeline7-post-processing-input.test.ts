import { expect, test } from "bun:test"
import * as dataset01 from "@tscircuit/autorouting-dataset-01"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import type { SimpleRouteJson } from "lib/types"

test("Pipeline7 produces solver-compatible post-processing input from legacy obstacles", () => {
  const srj = structuredClone(
    (dataset01 as Record<string, unknown>).circuit003,
  ) as SimpleRouteJson
  const legacyOval = { ...srj.obstacles[0], type: "oval" }
  srj.obstacles[0] = legacyOval as unknown as (typeof srj.obstacles)[number]
  const solver = new AutoroutingPipelineSolver7_MultiGraph(srj, {
    cacheProvider: null,
  })

  solver.solve()

  const input = solver.lengthMatchingPostProcessingSolver!.inputProblem
  expect(input.obstacles[0]).toMatchObject({
    type: "rect",
    center: legacyOval.center,
    width: legacyOval.width,
    height: legacyOval.height,
  })
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
})
