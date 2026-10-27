import { writeFile } from "node:fs/promises"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { loadScenarioBySampleNumber, parseDatasetName, toSimpleRouteJson } from "../benchmark/scenarios"

const dataset = parseDatasetName(process.argv[2] ?? "srj18")
const sample = Number(process.argv[3] ?? 1)
if (!dataset || !Number.isSafeInteger(sample) || sample < 1) throw new Error("Usage: inspect-joint-component-escape.ts DATASET SAMPLE [OUTPUT.json]")
const scenario = await loadScenarioBySampleNumber(dataset, sample)
const srj = toSimpleRouteJson(scenario.scenario)
if (!srj) throw new Error("Scenario is not SimpleRouteJson")
const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, { effort: 1, cacheProvider: null })
const started = performance.now()
while (!pipeline.solved && !pipeline.failed && !pipeline.jointComponentEscapePlannerSolver?.solved) pipeline.step()
if (pipeline.failed) throw new Error(pipeline.error ?? "Pipeline failed before joint escape planning")
const planner = pipeline.jointComponentEscapePlannerSolver
if (!planner?.solved) throw new Error("Pipeline did not execute joint escape planner")
const result = { dataset, sample, scenarioName: scenario.scenarioName,
  componentCount: pipeline.componentDetectionSolver!.getOutput().length,
  elapsedMs: performance.now() - started, stats: planner.stats }
if (process.argv[4]) await writeFile(process.argv[4], JSON.stringify({ ...result, blockedPortalSamples: planner.blockedPortalSamples, input: planner.getConstructorParams()[0] }, null, 2))
console.log(JSON.stringify(result))
