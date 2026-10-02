import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph as Pipeline9 } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { measurePostRoutingMetrics } from "lib/solvers/PostRoutingOptimization/measurePostRoutingMetrics"
import type {
  PostRoutingOptimizationInput,
  PostRoutingOptimizationOptions,
} from "lib/solvers/PostRoutingOptimization/optimizePostRouting"
import { validatePostRoutingCandidate } from "lib/solvers/PostRoutingOptimization/validatePostRoutingCandidate"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { phaseOptions } from "../post-routing/fixtures"
import { createComparisonBoard } from "../post-routing/comparison-fixtures"

test("same-corpus four-arm controls validate every output under equal total search budgets", () => {
  const rows: object[] = []
  for (const [offset, width] of [
    [0, 0.3],
    [-20, 0.4],
    [50, 0.6],
  ]) {
    const srj = createComparisonBoard(offset, width)
    const original = JSON.stringify(srj)
    const owners = new Map(srj.connections.map((c) => [c.name, c.name]))
    let baselineTraces: string | undefined
    for (const arm of ["baseline", "A", "B", "A+B"]) {
      const passCount = arm === "A+B" ? 2 : 1
      const options = phaseOptions()
      options.search.maxExpansions = 300_000 / passCount
      options.search.maxMilliseconds = 10_000 / passCount
      options.objective.maxBendIncrease = 4
      const nativeGate = (input: PostRoutingOptimizationInput) => {
        const drc = evaluateRelaxedDrc({
          inputSrj: { ...input.srj, traces: [] },
          srjWithPointPairs: input.srj,
          routedTraces: input.traces,
          includeBoardClearance: true,
          drcOptions: {
            traceClearance: input.srj.minTraceToPadEdgeClearance,
            holeClearance: input.srj.minTraceToHoleEdgeClearance,
          },
        })
        return {
          valid: drc.errors.length === 0,
          diagnostics: drc.errors.map((error) => JSON.stringify(error)),
        }
      }
      const tree: PostRoutingOptimizationOptions = {
        ...structuredClone(options),
        validate: nativeGate,
      }
      tree.nets.forEach((plan) => delete plan.componentPlanning)
      const forest = { ...options, validate: nativeGate }
      const routingOptions = {
        effort: 0.1,
        cacheProvider: null,
        ...(arm.includes("A") ? { dynamicNetTreeRouting: tree } : {}),
        ...(arm.includes("B") ? { postRoutingOptimization: forest } : {}),
      }
      const solver = new Pipeline9(structuredClone(srj), routingOptions)
      const random = Math.random
      let state = 1
      Math.random = () => {
        state = (Math.imul(1664525, state) + 1013904223) >>> 0
        return state / 2 ** 32
      }
      const started = performance.now()
      try {
        solver.solve()
      } finally {
        Math.random = random
      }
      expect(solver.solved).toBe(true)
      expect(
        solver.pipelineDef.some(
          (stage) => stage.solverName === "dynamicNetTreeSolver",
        ),
      ).toBe(arm.includes("A"))
      expect(
        solver.pipelineDef.some(
          (stage) => stage.solverName === "postRoutingForestSolver",
        ),
      ).toBe(arm.includes("B"))
      const traces = solver.getOutputSimpleRouteJson().traces!
      const physical = validatePostRoutingCandidate(srj, traces, owners)
      const native = nativeGate({ srj, traces, traceOwners: owners })
      expect(physical).toEqual({ valid: true, diagnostics: [] })
      expect(native).toEqual({ valid: true, diagnostics: [] })
      expect(JSON.stringify(srj)).toBe(original)
      if (arm === "baseline") baselineTraces = JSON.stringify(traces)
      rows.push({
        arm,
        offset,
        width,
        seed: 1,
        totalExtraExpansions: arm === "baseline" ? 0 : 300_000,
        totalExtraMilliseconds: arm === "baseline" ? 0 : 10_000,
        metrics: measurePostRoutingMetrics(traces, owners),
        nativeErrors: native.diagnostics.length,
        physicalOpensOrRuleErrors: physical.diagnostics.length,
        sha256: createHash("sha256")
          .update(JSON.stringify(traces))
          .digest("hex"),
        unchangedFromBaseline: JSON.stringify(traces) === baselineTraces,
        finalStatus: solver.getPostRoutingOptimizationResult()?.status,
        diagnostics: solver.getPostRoutingOptimizationResult()?.diagnostics,
        wallMilliseconds: performance.now() - started,
      })
    }
  }
  console.log("POST_ROUTING_FOUR_ARM " + JSON.stringify(rows))
})
