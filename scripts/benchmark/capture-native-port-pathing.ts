import { createHash } from "node:crypto"
import { writeFileSync } from "node:fs"
import { gzipSync } from "node:zlib"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { loadScenarioBySampleNumber } from "./scenarios"

type NativePhase = {
  inputProblem: { serializedHyperGraph: unknown }
  loadHyperGraph(input: unknown): { topology: unknown; problem: unknown }
  getSolveGraphOptions(): unknown
}

const sampleNumber = Number(process.argv[2] ?? 14)
const outputPath = process.argv[3] ?? "native-port-pathing.json"
const { scenario } = await loadScenarioBySampleNumber("srj18", sampleNumber)
const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(scenario, {
  effort: 1,
  cacheProvider: null,
})
pipeline.solveUntilPhase("portPointPathingSolver")
if (!pipeline.portPointPathingSolver) pipeline.step()
if (pipeline.failed || !pipeline.portPointPathingSolver) {
  throw new Error(pipeline.error ?? "Pipeline9 did not reach port-point pathing")
}
const phase = (pipeline.portPointPathingSolver as unknown as {
  tinyPipelineSolver: NativePhase
}).tinyPipelineSolver
const loaded = phase.loadHyperGraph(phase.inputProblem.serializedHyperGraph)
const input = {
  captureKind: "native-pipeline9-solveGraph-input",
  sampleNumber,
  effort: 1,
  revision: process.env.GITHUB_SHA,
  ...loaded,
  options: phase.getSolveGraphOptions(),
}
const json = JSON.stringify(input, (_key, value) => {
  if (ArrayBuffer.isView(value)) {
    return {
      $typed: value.constructor.name,
      values: Array.from(value as unknown as ArrayLike<number>),
    }
  }
  return value
})
writeFileSync(outputPath, json)
writeFileSync(`${outputPath}.gz`, gzipSync(json))
console.log(JSON.stringify({
  outputPath,
  bytes: Buffer.byteLength(json),
  sha256: createHash("sha256").update(json).digest("hex"),
}))
if (process.argv.includes("--emit-capture")) {
  const compressed = gzipSync(json).toString("base64")
  for (let index = 0; index < compressed.length; index += 16000) {
    console.log(`PORT_CAPTURE_CHUNK ${index}: ${compressed.slice(index, index + 16000)}`)
  }
}
