import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "../../lib/types"

test("Pipeline9 forwards differential-pair maximum uncoupled length", async () => {
  const fixtureUrl = new URL(
    "../fixtures/core-differential-pair-pad-clearance.json",
    import.meta.url,
  )
  const input: SimpleRouteJson = await Bun.file(fixtureUrl).json()
  input.differentialPairs![0]!.maxUncoupledLength = 3
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input)

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(
    solver.differentialPairRoutingSolver!.getConstructorParams()[0],
  ).toMatchObject({ differentialPairs: [{ maxUncoupledLength: 3 }] })
})
