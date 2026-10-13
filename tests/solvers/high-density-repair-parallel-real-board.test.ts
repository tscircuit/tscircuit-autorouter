import { expect, test } from "bun:test"
import * as dataset01 from "@tscircuit/autorouting-dataset-01"
import { AutoroutingPipelineSolver4 } from "lib/autorouter-pipelines/AutoroutingPipeline4_TinyHypergraph/AutoroutingPipelineSolver4_TinyHypergraph"
import { Pipeline4HighDensityRepairSolver } from "lib/solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSolver"
import { solveHighDensityRepairSample } from "lib/solvers/HighDensityRepairSolver/solveHighDensityRepairSample"
import type { SimpleRouteJson } from "lib/types"

test("parallel repair matches sequential geometry and stats on a routed dataset board", async () => {
  const srj = (dataset01 as Record<string, unknown>).circuit003 as SimpleRouteJson
  const pipeline = new AutoroutingPipelineSolver4(srj, { cacheProvider: null })
  pipeline.solveUntilPhase("highDensityRepairSolver")
  const stage = pipeline.pipelineDef.find((step) => step.solverName === "highDensityRepairSolver")!
  const [params] = stage.getConstructorParams(pipeline) as [ConstructorParameters<typeof Pipeline4HighDensityRepairSolver>[0]]
  const sequential = new Pipeline4HighDensityRepairSolver(params)
  sequential.solve()
  expect(sequential.solved).toBe(true)
  expect(sequential.sampleEntries.length).toBeGreaterThan(1)
  const parallel = new Pipeline4HighDensityRepairSolver({
    ...params,
    parallelRepair: { concurrency: 4, executor: async (input) => solveHighDensityRepairSample(input) },
  })
  await parallel.solveAsync()
  expect(parallel.solved).toBe(true)
  expect(parallel.failed).toBe(false)
  expect(JSON.stringify(parallel.getOutput())).toBe(JSON.stringify(sequential.getOutput()))
  expect(parallel.stats).toEqual(sequential.stats)
})
