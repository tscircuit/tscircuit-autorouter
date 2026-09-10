import { expect, test } from "bun:test"
import {
  checkEachPcbPortConnectedToPcbTraces,
  checkSourceTracesHavePcbTraces,
} from "@tscircuit/checks"
import { HighDensityForceImproveSolver } from "high-density-repair01/lib/HighDensityForceImproveSolver"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph as Pipeline } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "lib/types"

type CapturedPhase = { input: SimpleRouteJson; output: SimplifiedPcbTraces }
type Phases = {
  clocks: CapturedPhase
  bootFlash: CapturedPhase
  remaining: SimpleRouteJson
}

type HdSolver = NonNullable<Pipeline["highDensityRouteSolver"]>
type Checkpoint = {
  repairInput: ConstructorParameters<typeof HighDensityForceImproveSolver>
  pathingOutput: ReturnType<
    NonNullable<Pipeline["portPointPathingSolver"]>["getOutput"]
  >
  updatedFixedHdRoutes: ReturnType<HdSolver["getUpdatedFixedHdRoutes"]>
  fixedRouteReplacements: Array<
    Parameters<HdSolver["fixedRouteReplacements"]["set"]>
  >
  preloadedTraceMutationMasks: Array<
    Parameters<HdSolver["preloadedTraceMutationMasks"]["set"]>
  >
}

test("routes the RV1106 remaining phase through Pipeline9", async (): Promise<void> => {
  const phases: Phases = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL("./assets/rv1106-routing/phases.json.gz", import.meta.url),
        ),
      ),
    ).toString(),
  )
  expect(phases.clocks.output).toHaveLength(11)
  expect(phases.bootFlash.input.traces).toEqual(phases.clocks.output)
  expect(phases.bootFlash.output).toHaveLength(21)
  expect(phases.remaining.traces).toEqual(phases.bootFlash.output)
  expect(phases.remaining.connections).toHaveLength(36)
  for (const [name, phase] of Object.entries({
    clocks: phases.clocks,
    bootFlash: phases.bootFlash,
  })) {
    await expect(
      getSvgFromGraphicsObject(convertSrjToGraphicsObject(phase.input), {
        backgroundColor: "white",
      }),
    ).toMatchSvgSnapshot(import.meta.path, { svgName: `${name}-input` })
    // Saved phase outputs include all preloaded copper already.
    await expect(
      getBugReportSnapshotSvg({
        inputSrj: { ...phase.input, traces: [] },
        srjWithPointPairs: phase.input,
        routedTraces: phase.output,
      }),
    ).toMatchSvgSnapshot(import.meta.path, { svgName: `${name}-output` })
  }
  await expect(
    getSvgFromGraphicsObject(convertSrjToGraphicsObject(phases.remaining), {
      backgroundColor: "white",
    }),
  ).toMatchSvgSnapshot(import.meta.path, { svgName: "remaining-input" })
  const pipeline = new Pipeline(phases.remaining, { cacheProvider: null })
  // Default replay skips only the captured prefix; the opt-in run verifies it.
  if (process.env.RV1106_FULL_REPRO !== "1") {
    const checkpoint: Checkpoint = JSON.parse(
      gunzipSync(
        new Uint8Array(
          readFileSync(
            new URL(
              "./assets/rv1106-routing/checkpoint.json.gz",
              import.meta.url,
            ),
          ),
        ),
      ).toString(),
    )
    while (
      pipeline.getCurrentPhase() !== "portPointPathingSolver" &&
      !pipeline.failed
    )
      pipeline.step()
    expect(pipeline.failed).toBe(false)
    pipeline.step()
    pipeline.portPointPathingSolver!.getOutput = () => checkpoint.pathingOutput
    pipeline.portPointPathingSolver!.computeNodePfMap = () => new Map()
    pipeline.activeSubSolver = null
    pipeline.currentPipelineStepIndex++
    while (
      pipeline.getCurrentPhase() !== "highDensityRouteSolver" &&
      !pipeline.failed
    )
      pipeline.step()
    expect(pipeline.failed).toBe(false)
    pipeline.step()
    for (const [
      connectionName,
      replacement,
    ] of checkpoint.fixedRouteReplacements) {
      pipeline.highDensityRouteSolver!.fixedRouteReplacements.set(
        connectionName,
        replacement,
      )
    }
    for (const [
      connectionName,
      mask,
    ] of checkpoint.preloadedTraceMutationMasks) {
      pipeline.highDensityRouteSolver!.preloadedTraceMutationMasks.set(
        connectionName,
        mask,
      )
    }
    pipeline.highDensityRouteSolver!.getUpdatedFixedHdRoutes = () =>
      checkpoint.updatedFixedHdRoutes
    pipeline.highDensityForceImproveSolver = new HighDensityForceImproveSolver({
      nodeWithPortPoints: pipeline.highDensityNodePortPoints!,
      hdRoutes: checkpoint.repairInput[0].hdRoutes,
    })
    pipeline.activeSubSolver = null
    pipeline.currentPipelineStepIndex = pipeline.pipelineDef.findIndex(
      (stage) => stage.solverName === "highDensityRepairSolver",
    )
    expect(pipeline.currentPipelineStepIndex).toBeGreaterThanOrEqual(0)
  }
  let lastProgress = performance.now()
  while (!pipeline.solved && !pipeline.failed) {
    pipeline.step()
    if (performance.now() - lastProgress > 30_000) {
      console.log({
        phase: pipeline.getCurrentPhase(),
        iterations: pipeline.iterations,
        activeIterations: pipeline.activeSubSolver?.iterations,
      })
      lastProgress = performance.now()
    }
  }
  expect(pipeline.failed).toBe(false)
  expect(pipeline.solved).toBe(true)
  const validation = {
    inputSrj: phases.remaining,
    srjWithPointPairs: pipeline.srjWithPointPairs!,
    routedTraces: pipeline.getOutputSimplifiedPcbTraces(),
  }
  const drc = evaluateRelaxedDrc(validation)
  expect(drc.errors).toHaveLength(25)
  expect(validation.routedTraces).toHaveLength(239)
  expect(checkSourceTracesHavePcbTraces(drc.circuitJson)).toEqual([])
  expect(checkEachPcbPortConnectedToPcbTraces(drc.circuitJson)).toEqual([])
  console.log({
    drcCount: drc.errors.length,
    traceCount: validation.routedTraces.length,
    timings: pipeline.timeSpentOnPhase,
  })
  await expect(getBugReportSnapshotSvg(validation)).toMatchSvgSnapshot(
    import.meta.path,
  )
})
