import { createHash } from "node:crypto"
import { writeFile } from "node:fs/promises"
import { availableParallelism, cpus } from "node:os"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { TinyHypergraphPortPointPathingSolver } from "../../lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import { loadScenarioBySampleNumber } from "./scenarios"

type Row = {
  sample: number
  repeat: number
  constructorMs: number
  phaseMs: number
  iterations: number
  outputSha256: string
}

const args = process.argv.slice(2)
const options = new Map<string, string>()
for (let i = 0; i < args.length; i += 2) {
  const key = args[i]
  const value = args[i + 1]
  if (!["--samples", "--repeat", "--output"].includes(key) || !value) {
    throw new Error("Usage: bun scripts/benchmark/port-point-pathing.ts [--samples 1,2,6] [--repeat 3] [--output results.json]")
  }
  options.set(key, value)
}
const samples = options.has("--samples")
  ? options.get("--samples")!.split(",").map(Number)
  : Array.from({ length: 16 }, (_, i) => i + 1)
const repeats = Number(options.get("--repeat") ?? 3)
if (
  !Number.isSafeInteger(repeats) || repeats < 1 ||
  samples.some((sample) => !Number.isSafeInteger(sample) || sample < 1 || sample > 16)
) {
  throw new Error("--repeat must be positive; --samples must contain dataset18 sample numbers 1–16")
}

const rows: Row[] = []
for (const sample of samples) {
  const { scenario } = await loadScenarioBySampleNumber("srj18", sample)
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(scenario, {
    cacheProvider: null,
  })
  while (!pipeline.portPointPathingSolver && !pipeline.failed && !pipeline.solved) {
    pipeline.step()
  }
  if (pipeline.failed || !pipeline.portPointPathingSolver) {
    throw new Error(`Sample ${sample} did not reach pathing: ${pipeline.error}`)
  }
  const [input] = pipeline.portPointPathingSolver.getConstructorParams()
  let expectedHash: string | undefined
  for (let repeat = 1; repeat <= repeats; repeat++) {
    // Inputs include shared references and Maps; JSON round-tripping is unsafe.
    const params = structuredClone(input)
    const constructorStart = performance.now()
    const solver = new TinyHypergraphPortPointPathingSolver(params)
    const solveStart = performance.now()
    solver.solve()
    const solveEnd = performance.now()
    if (solver.failed || !solver.solved) {
      throw new Error(`Sample ${sample}, repeat ${repeat}: ${solver.error}`)
    }
    const outputSha256 = createHash("sha256")
      .update(JSON.stringify(solver.getOutput()))
      .digest("hex")
    if (expectedHash !== undefined && outputSha256 !== expectedHash) {
      throw new Error(`Sample ${sample} produced different routes on repeat ${repeat}`)
    }
    expectedHash = outputSha256
    const row: Row = {
      sample,
      repeat,
      constructorMs: solveStart - constructorStart,
      phaseMs: solveEnd - solveStart,
      iterations: solver.iterations,
      outputSha256,
    }
    rows.push(row)
    console.log(JSON.stringify(row))
  }
}
if (options.has("--output")) {
  await writeFile(options.get("--output")!, JSON.stringify({
    dataset: "srj18",
    pipeline: "AutoroutingPipelineSolver9_PreloadedTraceGraph",
    runtime: { bun: Bun.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model, availableParallelism: availableParallelism() },
    timing: "phaseMs measures solve() only; constructorMs is separate; output serialization and hashing are excluded",
    rows,
  }, null, 2))
}
