import { expect, test } from "bun:test"
import { AUTOROUTER_VERSION } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/autorouterVersion"
import { Pipeline9NetworkedHighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/Pipeline9NetworkedHighDensitySolver"
import type { Pipeline9NetworkedHighDensityNodeInput } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/pipeline9NetworkedTypes"
import { PIPELINE9_NETWORKED_SOLVE_POLICY } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/pipeline9NetworkedTypes"
import { solvePipeline9NetworkedHighDensityNode } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/solvePipeline9NetworkedHighDensityNode"
import { createNetworkFixedPadProblem } from "../fixtures/createNetworkFixedPadProblem"

test("the physical-clearance network schema rejects previous policies before routing", (): void => {
  const { node, connMap, obstacles, fixedPadClearance } =
    createNetworkFixedPadProblem()
  const solver = new Pipeline9NetworkedHighDensitySolver({
    nodePortPoints: [node],
    fixedHdRoutes: [],
    connMap,
    colorMap: {},
    obstacles,
    fixedPadClearance,
    layerCount: 2,
    traceWidth: 0.2,
    viaDiameter: 0.3,
    obstacleMargin: 0.1,
    effort: 1,
    nodePfById: {},
    enableRegionalFallback: false,
    autorouterVersion: AUTOROUTER_VERSION,
  })
  const input = solver["createNodeInput"](node)
  expect(input.solvePolicy).toBe(PIPELINE9_NETWORKED_SOLVE_POLICY)
  expect(input.solvePolicy).toContain("fixed_pad_clearance")
  expect(input.solvePolicy.endsWith("_v6")).toBeTrue()
  for (const solvePolicy of [
    "ordinary_then_regional_without_fixed_copper_v1",
    "ordinary_with_fixed_pad_clearance_then_regional_without_fixed_copper_v2",
    "ordinary_with_fixed_pad_clearance_then_regional_without_fixed_copper_v3",
    "ordinary_with_fixed_pad_clearance_then_regional_without_fixed_copper_v4",
    "ordinary_with_fixed_pad_clearance_then_regional_without_fixed_copper_v5",
  ]) {
    const legacyInput = {
      ...input,
      solvePolicy,
    } as unknown as Pipeline9NetworkedHighDensityNodeInput
    expect((): void => {
      solvePipeline9NetworkedHighDensityNode(legacyInput)
    }).toThrow("Unsupported Pipeline9 networked solve policy")
  }
  expect(solver.stats.remoteRequestsStarted).toBe(0)
})
