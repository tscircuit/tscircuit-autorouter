import { expect, test } from "bun:test"
import { sample003 } from "dataset-srj18"
import { AutoroutingPipelineSolver9_Networked } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/AutoroutingPipelineSolver9_Networked"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"
import { ExampleHdCache2Server } from "tests/fixtures/example-hd-cache2-server"

test("Pipeline9 node and global repairs produce identical SRJ18 output over HTTP", async () => {
  const local = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(sample003) as SimpleRouteJson,
    { effort: 1 },
  )
  local.solve()
  expect(local.solved).toBeTrue()

  const server = new ExampleHdCache2Server()
  try {
    const networked = new AutoroutingPipelineSolver9_Networked(
      structuredClone(sample003) as SimpleRouteJson,
      { effort: 1, hdCache2ServerUrl: server.url },
    )
    await networked.solveAsync()
    expect(networked.solved).toBeTrue()
    expect(server.solveRequests.length).toBeGreaterThan(0)
    expect(
      networked.highDensityRouteSolver!.stats.remoteSolvedResults,
    ).toBeGreaterThan(0)
    // HTTP serializes negative zero as zero; compare the exact JSON output.
    expect(JSON.stringify(networked.highDensityRepairSolver!.getOutput())).toBe(
      JSON.stringify(local.highDensityRepairSolver!.getOutput()),
    )
    expect(JSON.stringify(networked.getOutputSimpleRouteJson())).toBe(
      JSON.stringify(local.getOutputSimpleRouteJson()),
    )
  } finally {
    await server.close()
  }
})
