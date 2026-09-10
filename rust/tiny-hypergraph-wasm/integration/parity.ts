import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import * as samples from "dataset-srj18"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "../../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { TinyHypergraphPortPointPathingSolver } from "../../../lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import { enableTinyHypergraphWasm } from "../../../lib/solvers/PortPointPathingSolver/tinyhypergraph/WasmTinyHypergraphPipeline"
import type { SimpleRouteJson } from "../../../lib/types"

async function checkParity(): Promise<void> {
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

  await enableTinyHypergraphWasm(await readFile(new URL(
    "../pkg/tiny_hypergraph_wasm_bg.wasm", import.meta.url,
  )))
  const rust = new TinyHypergraphPortPointPathingSolver(params)
  rust.solve()
  assert.equal(rust.solved, ts.solved, `${sampleName}: solved`)
  assert.equal(rust.failed, ts.failed, `${sampleName}: failed`)
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
