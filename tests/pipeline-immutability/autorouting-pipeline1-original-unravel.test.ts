import { expect, test } from "bun:test"
import { AutoroutingPipeline1_OriginalUnravel } from "lib/autorouter-pipelines/AutoroutingPipeline1_OriginalUnravel/AutoroutingPipeline1_OriginalUnravel"
import type { SimpleRouteJson } from "lib/types"
import bugReproJson from "../repro/pipeline1-bug1.json"

test(
  "AutoroutingPipeline1_OriginalUnravel solves and does not mutate input SRJ",
  () => {
    const srj = structuredClone(bugReproJson as SimpleRouteJson)
    const before = structuredClone(srj)

    const solver = new AutoroutingPipeline1_OriginalUnravel(srj)
    solver.solve()

    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    expect(srj).toEqual(before)
  },
  { timeout: 180_000 },
)
