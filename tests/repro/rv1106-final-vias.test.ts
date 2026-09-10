import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph as Pipeline } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { HighDensityForceImproveSolver } from "high-density-repair01/lib/HighDensityForceImproveSolver"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { checkSourceTracesHavePcbTraces, checkEachPcbPortConnectedToPcbTraces } from "@tscircuit/checks"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"

type HdSolver = NonNullable<Pipeline["highDensityRouteSolver"]>
type Checkpoint = {
  repairInput: ConstructorParameters<typeof HighDensityForceImproveSolver>
  pathingOutput: ReturnType<NonNullable<Pipeline["portPointPathingSolver"]>["getOutput"]>
  updatedFixedHdRoutes: ReturnType<HdSolver["getUpdatedFixedHdRoutes"]>
  fixedRouteReplacements: Array<Parameters<HdSolver["fixedRouteReplacements"]["set"]>>
  preloadedTraceMutationMasks: Array<Parameters<HdSolver["preloadedTraceMutationMasks"]["set"]>>
}
type CapturedPhase = { input: SimpleRouteJson; output: SimplifiedPcbTrace[] }
type Phases = { clocks: CapturedPhase; bootFlash: CapturedPhase; remaining: SimpleRouteJson }

test("RV1106 phased Pipeline9 repairs final same-net via spacing", async (): Promise<void> => {
  const phases: Phases = JSON.parse(gunzipSync(new Uint8Array(readFileSync(new URL("./assets/rv1106-final-vias/phases.json.gz", import.meta.url)))).toString())

  const checkpoint: Checkpoint = JSON.parse(gunzipSync(new Uint8Array(readFileSync(new URL("./assets/rv1106-final-vias/checkpoint.json.gz", import.meta.url)))).toString())
  // Resume captured detailed routing; run real registered repair and downstream stages.
  const originalInput = phases.remaining
  expect(phases.clocks.output).toHaveLength(11)
  expect(phases.bootFlash.output).toHaveLength(21)
  expect(originalInput.connections).toHaveLength(36)
  for (const [name, phase] of Object.entries({ clocks: phases.clocks, bootFlash: phases.bootFlash })) {
    await expect(getSvgFromGraphicsObject(convertSrjToGraphicsObject(phase.input))).toMatchSvgSnapshot(import.meta.path, { svgName: `${name}-input` })
    await expect(getBugReportSnapshotSvg({ inputSrj: phase.input, srjWithPointPairs: phase.input, routedTraces: phase.output })).toMatchSvgSnapshot(import.meta.path, { svgName: `${name}-output` })
  }
  await expect(getSvgFromGraphicsObject(convertSrjToGraphicsObject(originalInput))).toMatchSvgSnapshot(import.meta.path, { svgName: "remaining-input" })
  const pipeline = new Pipeline(originalInput, { cacheProvider: null })
  while (pipeline.getCurrentPhase() !== "portPointPathingSolver" && !pipeline.failed) pipeline.step()
  expect(pipeline.failed).toBe(false)
  pipeline.step()
  pipeline.portPointPathingSolver!.getOutput = () => checkpoint.pathingOutput
  pipeline.portPointPathingSolver!.computeNodePfMap = () => new Map()
  pipeline.activeSubSolver = null
  pipeline.currentPipelineStepIndex++
  while (pipeline.getCurrentPhase() !== "highDensityRouteSolver" && !pipeline.failed) pipeline.step()
  expect(pipeline.failed).toBe(false)
  pipeline.step()
  for (const [connectionName, replacement] of checkpoint.fixedRouteReplacements) {
    pipeline.highDensityRouteSolver!.fixedRouteReplacements.set(connectionName, replacement)
  }
  for (const [connectionName, mask] of checkpoint.preloadedTraceMutationMasks) {
    pipeline.highDensityRouteSolver!.preloadedTraceMutationMasks.set(connectionName, mask)
  }
  pipeline.highDensityRouteSolver!.getUpdatedFixedHdRoutes = () => checkpoint.updatedFixedHdRoutes
  pipeline.highDensityForceImproveSolver = new HighDensityForceImproveSolver({nodeWithPortPoints:pipeline.highDensityNodePortPoints!,hdRoutes:checkpoint.repairInput[0].hdRoutes})
  pipeline.activeSubSolver = null
  pipeline.currentPipelineStepIndex = pipeline.pipelineDef.findIndex((stage) => stage.solverName === "highDensityRepairSolver")
  pipeline.solve()
  expect(pipeline.failed).toBe(false)
  expect(pipeline.solved).toBe(true)
  const routedTraces = pipeline.getOutputSimplifiedPcbTraces()
  const validation = { inputSrj: originalInput, srjWithPointPairs: pipeline.srjWithPointPairs!, routedTraces }
  const drc = evaluateRelaxedDrc(validation)
  expect(drc.errors).toHaveLength(29)
  expect(drc.errors.filter((error) => error.type === "pcb_via_clearance_error")).toHaveLength(2)
  expect(checkSourceTracesHavePcbTraces(drc.circuitJson)).toEqual([])
  expect(checkEachPcbPortConnectedToPcbTraces(drc.circuitJson)).toEqual([])
  await expect(getBugReportSnapshotSvg(validation)).toMatchSvgSnapshot(import.meta.path)
})
