import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import * as samples from "dataset-srj18"
import { BaseSolver } from "@tscircuit/solver-utils"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "../../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { PortfolioSingleIntraNodeSolver } from "../../../lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { enableTinyHypergraphWasm } from "../../../lib/solvers/PortPointPathingSolver/tinyhypergraph/WasmTinyHypergraphPipeline"
import { enableHighDensityWasm } from "../../../lib/solvers/HyperHighDensitySolver/enableHighDensityWasm"
import type { SimpleRouteJson } from "../../../lib/types"

type EngineTiming = {
  variant: "a01" | "a03"
  nodeId: string
  constructMs: number
  setupMs: number
  searchMs: number
  outputMs: number
  outputCalls: number
  outputHashes: string[]
  stepCalls: number
  iterations: number
  maxIterations: number
  solved: boolean
  failed: boolean
}

type Capture = {
  backend: string
  sample: string
  initMs: number
  boardMs: number
  solved: boolean
  failed: boolean
  iterations: number
  phaseMs: Record<string, number>
  tracesHash: string
  engines: EngineTiming[]
}

const sampleNumber = process.argv[2] ?? "16"
const outDir = resolve(process.argv[3] ?? "/tmp/high-density-timing")
const backend = process.argv[4]
const runLabel = process.argv[5]
const sampleName = `sample${String(Number(sampleNumber)).padStart(3, "0")}`

if (backend) {
  assert.ok(backend === "typescript" || backend === "wasm")
  const sample = (samples as Record<string, unknown>)[sampleName] as SimpleRouteJson
  assert.ok(sample, `Unknown SRJ18 sample ${sampleName}`)
  await enableTinyHypergraphWasm(await readFile(new URL("../../tiny-hypergraph-wasm/pkg/tiny_hypergraph_wasm_bg.wasm", import.meta.url)))
  const initStart = performance.now()
  if (backend === "wasm") {
    await enableHighDensityWasm({ module_or_path: await readFile(new URL("../pkg/high_density_wasm_bg.wasm", import.meta.url)) })
  }
  const initMs = performance.now() - initStart
  const engines: EngineTiming[] = []
  const generate = PortfolioSingleIntraNodeSolver.prototype.generateSolver
  PortfolioSingleIntraNodeSolver.prototype.generateSolver = function (hyperParameters): ReturnType<typeof generate> {
    const variant = hyperParameters.HIGH_DENSITY_A01 ? "a01" : hyperParameters.HIGH_DENSITY_A03 ? "a03" : undefined
    if (!variant) return generate.call(this, hyperParameters)
    const constructStart = performance.now()
    const result = generate.call(this, hyperParameters)
    const constructMs = performance.now() - constructStart
    const solver = result as unknown as BaseSolver
    const timing: EngineTiming = {
      variant, nodeId: this.nodeWithPortPoints.capacityMeshNodeId,
      constructMs, setupMs: 0, searchMs: 0, outputMs: 0,
      outputCalls: 0, outputHashes: [], stepCalls: 0,
      iterations: solver.iterations, maxIterations: solver.MAX_ITERATIONS, solved: solver.solved, failed: solver.failed,
    }
    engines.push(timing)
    const setup = solver._setup
    solver._setup = function (): void {
      const start = performance.now()
      try { setup.call(this) } finally { timing.setupMs += performance.now() - start }
      timing.maxIterations = this.MAX_ITERATIONS
      timing.solved = this.solved
      timing.failed = this.failed
    }
    const step = solver.step
    let batchStart = 0
    const batchSize = this.MIN_SUBSTEPS
    assert.equal(batchSize, 100, "Timing assumes the portfolio's 100-step batches")
    solver.step = function (): void {
      if (timing.stepCalls % batchSize === 0) batchStart = performance.now()
      step.call(this)
      timing.stepCalls++
      if (timing.stepCalls % batchSize === 0) {
        timing.searchMs += performance.now() - batchStart
        timing.iterations = this.iterations
        timing.maxIterations = this.MAX_ITERATIONS
        timing.solved = this.solved
        timing.failed = this.failed
      }
    }
    const output = solver.getOutput
    solver.getOutput = function (): unknown {
      const start = performance.now()
      const value: unknown = output.call(this)
      timing.outputMs += performance.now() - start
      timing.outputCalls++
      timing.outputHashes.push(createHash("sha256").update(JSON.stringify(value)).digest("hex"))
      return value
    }
    return result
  }
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(structuredClone(sample), { effort: 1 })
  const start = performance.now()
  solver.solve()
  const boardMs = performance.now() - start
  for (const timing of engines) assert.equal(timing.stepCalls % 100, 0, "Incomplete search timing batch")
  assert.ok(solver.solved && !solver.failed, `${sampleName}: ${solver.error}`)
  const capture: Capture = {
    backend, sample: sampleName, initMs, boardMs,
    solved: solver.solved, failed: solver.failed, iterations: solver.iterations,
    phaseMs: solver.timeSpentOnPhase,
    tracesHash: createHash("sha256").update(JSON.stringify(solver.getOutputSimplifiedPcbTraces())).digest("hex"),
    engines,
  }
  await writeFile(resolve(outDir, `${sampleName}-${runLabel}.json`), JSON.stringify(capture, null, 2))
  console.log(`${sampleName}/${runLabel}: ${(boardMs / 1000).toFixed(2)}s, ${engines.length} engines`)
} else {
  await mkdir(outDir, { recursive: true })
  const runs = ["typescript", "wasm", "wasm", "typescript"]
  let reference: Capture | undefined
  for (const [index, variant] of runs.entries()) {
    const label = `${index + 1}-${variant}`
    const child = Bun.spawn([process.execPath, import.meta.path, sampleNumber, outDir, variant, label], { stdout: "inherit", stderr: "inherit" })
    assert.equal(await child.exited, 0, `${sampleName}/${label} failed`)
    const capture = JSON.parse(await readFile(resolve(outDir, `${sampleName}-${label}.json`), "utf8")) as Capture
    if (!reference) reference = capture
    assert.equal(capture.tracesHash, reference.tracesHash, "Final trace bytes")
    assert.equal(capture.iterations, reference.iterations, "Pipeline iterations")
    assert.deepEqual(capture.engines.map(({ constructMs, setupMs, searchMs, outputMs, ...state }) => state), reference.engines.map(({ constructMs, setupMs, searchMs, outputMs, ...state }) => state), "Per-engine workload, states and output bytes")
  }
  console.log(`${sampleName}: all four runs have identical engine workloads and outputs`)
}
