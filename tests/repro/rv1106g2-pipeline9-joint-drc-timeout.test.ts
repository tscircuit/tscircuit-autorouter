import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/autorouting-pipeline-solver9-preloaded-trace-graph"
import type { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import srj from "./assets/rv1106g2-pipeline9.srj.json" with { type: "json" }

const JOINT_DRC_REPAIR_TIMEOUT_MS = 60_000

test.skip("RV1106G2 Pipeline9 completes joint DRC repair before timeout", () => {
  const simpleRouteJson = srj as SimpleRouteJson
  expect(simpleRouteJson.connections).toHaveLength(76)
  expect(simpleRouteJson.obstacles).toHaveLength(382)
  expect(simpleRouteJson.layerCount).toBe(4)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    simpleRouteJson,
    { cacheProvider: null, effort: 5 },
  )
  solver.solveUntilPhase("pipeline9JointDrcRepairSolver")
  const startedAtMs = performance.now()

  while (
    performance.now() - startedAtMs < JOINT_DRC_REPAIR_TIMEOUT_MS &&
    !solver.failed &&
    solver.getCurrentPhase() === "pipeline9JointDrcRepairSolver"
  ) {
    solver.step()
  }

  expect(solver.failed).toBeFalse()
  expect(solver.getCurrentPhase()).toBe("lengthMatchingPostProcessingSolver")
  expect(performance.now() - startedAtMs).toBeLessThan(
    JOINT_DRC_REPAIR_TIMEOUT_MS,
  )
  const svg = getSvgFromGraphicsObject(
    convertSrjToGraphicsObject(simpleRouteJson, { traceColorMode: "net" }),
    { backgroundColor: "white" },
  )
  expect(svg).toMatchSvgSnapshot(import.meta.path)
})
