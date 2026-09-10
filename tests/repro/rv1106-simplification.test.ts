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

import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

import { applyPipeline9TraceShortcuts } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9TraceShortcuts"
import { doHdRoutesTouch } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/doHdRoutesTouch"

type JointInput = ConstructorParameters<typeof Pipeline9JointDrcRepairSolver>[0]
type FrozenRepair = {
  jointInput: Omit<JointInput, "connMap" | "mutatedPreloadedTraceIds"> & { mutatedPreloadedTraceIds: string[] }
  netMap: ConnectivityMap["netMap"]
  routes: HighDensityRoute[]
}

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

test("RV1106 phased Pipeline9 preserves the captured post-repair board", async (): Promise<void> => {
  const phases: Phases = JSON.parse(gunzipSync(new Uint8Array(readFileSync(new URL("./assets/rv1106-final-vias/phases.json.gz", import.meta.url)))).toString())

  const checkpoint: Checkpoint = JSON.parse(gunzipSync(new Uint8Array(readFileSync(new URL("./assets/rv1106-final-vias/checkpoint.json.gz", import.meta.url)))).toString())
  // Restore phase context, then resume the captured post-repair board.
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
  const frozen: FrozenRepair = JSON.parse(gunzipSync(new Uint8Array(readFileSync(new URL("./assets/rv1106-simplification/post-repair.json.gz", import.meta.url)))).toString())
  const joint = new Pipeline9JointDrcRepairSolver({
    ...frozen.jointInput,
    connMap: new ConnectivityMap(frozen.netMap),
    mutatedPreloadedTraceIds: new Set(frozen.jointInput.mutatedPreloadedTraceIds),
  })
  expect(joint.exactRepairSolver).toBeDefined()
  let routes = frozen.routes
  joint.exactRepairSolver!.getOutput = () => routes
  pipeline.pipeline9JointDrcRepairSolver = joint
  routes = applyPipeline9TraceShortcuts({
    routes,
    otherHdRoutes: joint.fixedPreloadedObstacleRoutes,
    srj: { ...joint.params.originalSrj, obstacles: joint.params.obstacles },
    connMap: joint.params.connMap,
    colorMap: joint.params.colorMap,
    drcEvaluator: ({ routes: proposed }) => {
      if (!proposed) throw new Error("Expected candidate routes")
      joint.exactRepairSolver!.getOutput = () => proposed
      return evaluateRelaxedDrc({
        inputSrj: originalInput,
        srjWithPointPairs: pipeline.srjWithPointPairs!,
        routedTraces: [...joint.getMutatedPreloadedTraces(), ...pipeline.getNewTracesBeforePowerExpansion()],
      }).errors.map((error) => ({ ...error }))
    },
  })
  joint.exactRepairSolver!.getOutput = () => routes
  expect(routes.reduce((count, route) => count + route.route.length, 0)).toBe(4350)
  for (let i = 0; i < routes.length; i++) {
    expect(routes[i]!.vias).toEqual(frozen.routes[i]!.vias)
    expect(routes[i]!.route[0]).toEqual(frozen.routes[i]!.route[0])
    expect(routes[i]!.route.at(-1)).toEqual(frozen.routes[i]!.route.at(-1))
    for (const fixed of joint.fixedPreloadedObstacleRoutes) {
      if (doHdRoutesTouch(frozen.routes[i]!, fixed)) expect(doHdRoutesTouch(routes[i]!, fixed)).toBe(true)
    }
    for (let j = i + 1; j < routes.length; j++) {
      if (doHdRoutesTouch(frozen.routes[i]!, frozen.routes[j]!)) {
        expect(doHdRoutesTouch(routes[i]!, routes[j]!)).toBe(true)
      }
    }
  }
  pipeline.activeSubSolver = null
  pipeline.currentPipelineStepIndex = pipeline.pipelineDef.findIndex((stage) => stage.solverName === "lengthMatchingPostProcessingSolver")
  pipeline.solve()
  expect(pipeline.failed).toBe(false)
  expect(pipeline.solved).toBe(true)
  const routedTraces = pipeline.getOutputSimplifiedPcbTraces()
  const validation = { inputSrj: originalInput, srjWithPointPairs: pipeline.srjWithPointPairs!, routedTraces }
  const drc = evaluateRelaxedDrc(validation)
  expect(drc.errors).toHaveLength(25)
  expect(drc.errors.filter((error) => error.type === "pcb_via_clearance_error")).toHaveLength(0)
  expect(drc.errors.filter((error) => error.type === "pcb_via_trace_clearance_error")).toHaveLength(1)
  expect(checkSourceTracesHavePcbTraces(drc.circuitJson)).toEqual([])
  expect(checkEachPcbPortConnectedToPcbTraces(drc.circuitJson)).toEqual([])
  await expect(getBugReportSnapshotSvg(validation)).toMatchSvgSnapshot(import.meta.path)
})
