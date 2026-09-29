import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { AutoroutingDrcEngine, type SimpleRouteJson as RepairSrj, type SimplifiedPcbTraces as RepairTraces } from "high-density-repair03/lib"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "../lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { evaluateRelaxedDrc } from "../lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "../lib/types"
import type { HighDensityRoute } from "../lib/types/high-density-types"

const outputDirectory = process.argv[2]
if (!outputDirectory) throw new Error("Expected an output directory")
mkdirSync(outputDirectory, { recursive: true })
const inputText = readFileSync("tests/repro/assets/gameboy-full-board-through-vias.srj.json", "utf8")
const inputSrj = JSON.parse(inputText) as SimpleRouteJson
const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(inputSrj, { cacheProvider: null, effort: 1 })
const reports: Record<string, unknown>[] = []

const captureStage = (stage: string, hdRoutes?: HighDensityRoute[]): void => {
  if (!solver.srjWithPointPairs || !solver.netToPointPairsSolver) {
    throw new Error(`Missing point-paired input at ${stage}`)
  }
  const pairs = structuredClone(solver.srjWithPointPairs)
  const routedTraces: SimplifiedPcbTraces = hdRoutes
    ? convertPipeline7HdRoutesToSimplifiedPcbTraces({
        connections: solver.netToPointPairsSolver.newConnections,
        originalConnections: solver.originalSrj.connections,
        hdRoutes: structuredClone(hdRoutes),
        layerCount: solver.srj.layerCount,
        obstacles: solver.srj.obstacles,
        defaultViaHoleDiameter: solver.viaHoleDiameter,
        connMap: solver.connMap,
      })
    : solver.getOutputSimplifiedPcbTraces()
  const result = evaluateRelaxedDrc({ inputSrj, srjWithPointPairs: pairs, routedTraces })
  const blindErrors = evaluateRelaxedDrc({
    inputSrj: { ...inputSrj, allowBlindAndBuriedVias: true },
    srjWithPointPairs: { ...pairs, allowBlindAndBuriedVias: true },
    routedTraces,
  }).errors
  const blindErrorIds = new Set(blindErrors.filter((error) => error.type === "pcb_trace_error").map((error) => error.pcb_trace_error_id))
  const indexed = new AutoroutingDrcEngine(pairs as RepairSrj).evaluate(routedTraces as RepairTraces)
  const indexedErrorIds = new Set(indexed.errors.map((error) => error.pcb_trace_error_id))
  const spanContacts = result.errors.filter((error) =>
    error.type === "pcb_trace_error" &&
    error.message.includes("overlaps with pcb_via") &&
    error.message.includes("accidental contact") &&
    !blindErrorIds.has(error.pcb_trace_error_id),
  )
  const report = {
    stage,
    traces: routedTraces.length,
    vias: result.circuitJson.filter((element) => element.type === "pcb_via").length,
    drcCount: result.errors.length,
    spanContacts: spanContacts.length,
    missedSpanContacts: spanContacts.filter((error) => !indexedErrorIds.has(error.pcb_trace_error_id)).length,
    routeHash: createHash("sha256").update(JSON.stringify(routedTraces)).digest("hex"),
  }
  const directory = `${outputDirectory}/${stage}`
  mkdirSync(directory, { recursive: true })
  writeFileSync(`${directory}/routes.json`, JSON.stringify(routedTraces))
  writeFileSync(`${directory}/circuit.json`, JSON.stringify(result.circuitJson))
  writeFileSync(`${directory}/drc-errors.json`, JSON.stringify(result.errors, null, 2))
  writeFileSync(`${directory}/span-contacts.json`, JSON.stringify(spanContacts, null, 2))
  writeFileSync(`${directory}/pairs.json`, JSON.stringify(pairs))
  if (hdRoutes) writeFileSync(`${directory}/hd-routes.json`, JSON.stringify(hdRoutes))
  reports.push(report)
  writeFileSync(`${outputDirectory}/stages.json`, JSON.stringify(reports, null, 2))
  console.log("GAMEBOY_STAGE", JSON.stringify(report))
}

for (const definition of solver.pipelineDef) {
  const onSolved = definition.onSolved
  definition.onSolved = (pipeline): void => {
    onSolved?.(pipeline)
    switch (definition.solverName) {
      case "highDensityRouteSolver":
        captureStage(definition.solverName, pipeline.highDensityRouteSolver!.routes)
        break
      case "highDensityForceImproveSolver":
        captureStage(definition.solverName, pipeline.highDensityForceImproveSolver!.getOutput())
        break
      case "highDensityRepairSolver":
        captureStage(definition.solverName, pipeline.highDensityRepairSolver!.getOutput())
        break
      case "highDensityStitchSolver":
        captureStage(definition.solverName, pipeline.highDensityStitchSolver!.mergedHdRoutes)
        break
      case "traceSimplificationSolver":
        captureStage(definition.solverName, pipeline.traceSimplificationSolver!.simplifiedHdRoutes)
        break
      case "traceWidthSolver":
        captureStage(definition.solverName, pipeline.traceWidthSolver!.getHdRoutesWithWidths())
        break
      case "globalDrcForceImproveSolver":
        captureStage(definition.solverName, pipeline.globalDrcForceImproveSolver!.getOutput())
        writeFileSync(`${outputDirectory}/global-repair-stats.json`, JSON.stringify(pipeline.globalDrcForceImproveSolver!.stats, null, 2))
        break
      case "pipeline9JointDrcRepairSolver":
        captureStage(definition.solverName, pipeline.pipeline9JointDrcRepairSolver!.getOutput())
        writeFileSync(`${outputDirectory}/joint-repair-stats.json`, JSON.stringify(pipeline.pipeline9JointDrcRepairSolver!.stats, null, 2))
        break
      case "lengthMatchingPostProcessingSolver":
        captureStage(definition.solverName, pipeline.lengthMatchingPostProcessingSolver!.getOutput().hdRoutes)
        break
    }
  }
}
solver.solve()
if (!solver.solved || solver.failed || solver.error) throw new Error(`Routing failed: ${solver.error}`)
captureStage("final-after-power-expansion")
writeFileSync(`${outputDirectory}/input.sha256`, createHash("sha256").update(inputText).digest("hex"))
