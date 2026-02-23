import { expect, test } from "bun:test"
import { AssignableAutoroutingPipeline3 } from "lib/autorouter-pipelines/AssignableAutoroutingPipeline3/AssignableAutoroutingPipeline3"
import type { SimpleRouteJson } from "lib/types"
import reproJson from "../repro/dip16-basic.json"

test(
  "AssignableAutoroutingPipeline3 solves and does not mutate input SRJ",
  () => {
    const srj = structuredClone(reproJson as SimpleRouteJson)
    const before = structuredClone(srj)

    const solver = new AssignableAutoroutingPipeline3(srj)
    solver.solve()

    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    expect(srj).toEqual(before)
  },
  { timeout: 180_000 },
)
