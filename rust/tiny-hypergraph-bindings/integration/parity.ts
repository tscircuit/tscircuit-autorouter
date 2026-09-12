import assert from "node:assert/strict"
import * as samples from "dataset-srj18"
import { importReference } from "../../autorouter-bindings/integration/tsReference"
import { TinyHypergraphPortPointPathingSolver } from "../../../lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import type { SimpleRouteJson } from "../../../lib/types"

async function checkParity(): Promise<void> {
  const { AutoroutingPipelineSolver9_PreloadedTraceGraph } = await importReference<typeof import("../../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph")>("lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph.ts")
  const sampleName = process.argv[2]
  const sample = (samples as Record<string, unknown>)[sampleName!]
  assert.ok(sample, `Unknown srj18 sample: ${sampleName}`)
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(sample) as SimpleRouteJson,
    { effort: 1 },
  )
  while (!pipeline.failed && !pipeline.solved && !pipeline.portPointPathingSolver) {
    pipeline.step()
  }
  assert.equal(pipeline.failed, false, pipeline.error ?? sampleName)
  const ts = pipeline.portPointPathingSolver
  assert.ok(ts, "Pipeline did not create the port-pathing solver")
  const [params] = structuredClone(ts.getConstructorParams())
  ts.solve()

  const rust = new TinyHypergraphPortPointPathingSolver(params)
  rust.solve()
  assert.equal(rust.solved, ts.solved, `${sampleName}: solved`)
  assert.equal(rust.failed, ts.failed, `${sampleName}: failed`)
  assert.equal(rust.error, ts.error, `${sampleName}: error`)
  assert.equal(
    rust.getSolveGraphBenchmarkMetrics()?.iterations,
    ts.getSolveGraphBenchmarkMetrics()?.iterations,
    `${sampleName}: search iterations`,
  )
  if (ts.solved) {
    assert.deepEqual(rust.getOutput(), ts.getOutput(), `${sampleName}: routed output`)
  }
  console.log(`${sampleName}: identical ${ts.solved ? "output" : "failure and iteration count"}`)
}

await checkParity()
