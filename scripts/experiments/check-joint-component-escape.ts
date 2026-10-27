import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "../../lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber, parseDatasetName, toSimpleRouteJson } from "../benchmark/scenarios"

const dataset = parseDatasetName(process.argv[2] ?? "srj18")
const sample = Number(process.argv[3] ?? 3)
if (!dataset || !Number.isSafeInteger(sample) || sample < 1) throw new Error("Usage: check-joint-component-escape.ts DATASET SAMPLE")
const loaded = await loadScenarioBySampleNumber(dataset, sample)
const srj = toSimpleRouteJson(loaded.scenario)
if (!srj) throw new Error("Scenario is not SimpleRouteJson")
for (const enabled of [false, true]) {
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(structuredClone(srj), { effort: 1, cacheProvider: null, jointComponentEscapePlanning: enabled })
  let thrown: string | undefined
  try { pipeline.solve() } catch (error) { thrown = String(error) }
  let drcErrors: number | undefined
  let outputHash: string | undefined
  if (pipeline.solved) {
    const routedTraces = pipeline.getOutputSimplifiedPcbTraces()
    drcErrors = evaluateRelaxedDrc({ inputSrj: srj, srjWithPointPairs: pipeline.srjWithPointPairs!, routedTraces, includeBoardClearance: true }).errors.length
    outputHash = new Bun.CryptoHasher("sha256").update(JSON.stringify(pipeline.getOutputSimpleRouteJson())).digest("hex")
  }
  console.log(JSON.stringify({ dataset, sample, enabled, solved: pipeline.solved, failed: pipeline.failed,
    error: thrown ?? pipeline.error, drcErrors, outputHash, stats: pipeline.jointComponentEscapePlannerSolver?.stats }))
}
