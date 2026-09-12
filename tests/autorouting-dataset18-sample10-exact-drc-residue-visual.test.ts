import { expect, test } from "bun:test"
import { VisualizedGlobalDrcForceImproveSolver } from "high-density-repair03/fixture-support/VisualizedGlobalDrcForceImproveSolver"
import type {
  HighDensityRoute,
  SimpleRouteJson as RepairSimpleRouteJson,
} from "high-density-repair03/lib"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { createPipeline7AutoroutingDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/create-pipeline7-autorouting-drc-evaluator"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"
import { loadScenarioBySampleNumber } from "../scripts/benchmark/scenarios"
import {
  getGraphicsSvgFrames,
  type GraphicsSvgFrame,
} from "./fixtures/solver-svg-frames"

test("repairs dataset 18 sample 10's exact DRC errors", async () => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 10)
  const pipeline = new AutoroutingPipelineSolver7_MultiGraph(scenario, {
    cacheProvider: null,
  })

  pipeline.solveUntilPhase("exactGeometryDrcForceImproveSolver")
  expect(pipeline.failed).toBe(false)

  const srj = pipeline.srjWithPointPairs as SimpleRouteJson
  const inputRoutes = pipeline.globalDrcForceImproveSolver!.getOutput()
  const conversionOptions = {
    connections: pipeline.netToPointPairsSolver?.newConnections ?? [],
    originalConnections: pipeline.originalSrj.connections,
    layerCount: srj.layerCount,
    obstacles: srj.obstacles,
    defaultViaHoleDiameter: pipeline.viaHoleDiameter,
    connMap: pipeline.connMap,
    srjWithPointPairs: srj,
    originalSrj: pipeline.originalSrj,
  }
  const evaluateBenchmarkDrc = (
    routes: HighDensityRoute[],
  ): ReturnType<typeof evaluateRelaxedDrc> => {
    const routedTraces = convertPipeline7HdRoutesToSimplifiedPcbTraces({
      ...conversionOptions,
      hdRoutes: routes,
    })

    return evaluateRelaxedDrc({
      inputSrj: pipeline.originalSrj,
      srjWithPointPairs: srj,
      routedTraces,
    })
  }
  const viewer = new VisualizedGlobalDrcForceImproveSolver({
    srj: srj as unknown as RepairSimpleRouteJson,
    hdRoutes: inputRoutes,
    connMap: pipeline.connMap,
    drcEvaluator: createPipeline7AutoroutingDrcEvaluator(conversionOptions),
    viaHoleDiameter: pipeline.viaHoleDiameter,
    maxIterations: 1,
    enableLargeBoardBroadFallback: false,
    enablePostSolveClearanceRelaxation: false,
  })
  const inputDrc = evaluateBenchmarkDrc(inputRoutes)
  viewer.outputHdRoutes = inputRoutes
  const frames: GraphicsSvgFrame[] = [
    {
      name: `Exact DRC input: ${inputDrc.errors.length} benchmark errors`,
      step: 0,
      graphics: viewer.visualize(),
    },
  ]

  pipeline.step()
  while (
    pipeline.getCurrentPhase() === "exactGeometryDrcForceImproveSolver" &&
    !pipeline.failed
  ) {
    pipeline.step()
  }

  const exactSolver = pipeline.exactGeometryDrcForceImproveSolver!
  const outputRoutes = exactSolver.getOutput()
  const outputDrc = evaluateBenchmarkDrc(outputRoutes)
  viewer.outputHdRoutes = outputRoutes
  frames.push({
    name: `Exact DRC output: ${outputDrc.errors.length} benchmark errors`,
    step: "end",
    graphics: viewer.visualize(),
  })

  expect(inputDrc.errors.length).toBeGreaterThan(0)
  expect(outputDrc.errors).toHaveLength(0)
  expect(pipeline.failed).toBe(false)
  expect(exactSolver.solved).toBe(true)
  expect(exactSolver.failed).toBe(false)

  const snapshotPath =
    process.platform === "linux"
      ? import.meta.path.replace(/\.test\.ts$/, "-linux.test.ts")
      : import.meta.path

  await expect(
    getGraphicsSvgFrames({
      frames,
      columns: 2,
      backgroundColor: "white",
    }),
  ).toMatchSvgSnapshot(snapshotPath, { tolerance: 0 })
})
