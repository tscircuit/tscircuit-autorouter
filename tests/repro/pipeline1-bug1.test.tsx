import { test, expect } from "bun:test"
import { AutoroutingPipeline1_OriginalUnravel } from "lib/autorouter-pipelines/AutoroutingPipeline1_OriginalUnravel/AutoroutingPipeline1_OriginalUnravel"
import bugReproJson from "./pipeline1-bug1.json"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

test("pipeline1 bug1", () => {
  const solver = new AutoroutingPipeline1_OriginalUnravel(bugReproJson as any, {
    cacheProvider: null,
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})
