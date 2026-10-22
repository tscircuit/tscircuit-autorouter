import { expect, test } from "bun:test"
import { NegotiateTraceClearanceSolver } from "@tscircuit/repair04"
import type { DrcEvaluator } from "high-density-repair03/lib"
import {
  getPipeline9BoundedRepairBudget,
  type Pipeline9BoundedRepairBudget,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9BoundedRegionalRepairs"
import {
  Pipeline9BoundedRegionalRepairSolver,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9BoundedRegionalRepairSolver"
import {
  createBoundedRegionalRepairFixture,
} from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test(
  "production opts into paired search while custom budgets choose their direction",
  (): void => {
    const custom: Pipeline9BoundedRepairBudget = {
      maxRegions: 1,
      maxCandidateAttempts: 133,
      maxPathSearchNodes: 500_000,
      maxCandidateAttemptsPerRegion: 133,
      maxPathSearchNodesPerCall: 500_000,
    }
    const cases: Array<{
      budget: Pipeline9BoundedRepairBudget
      directions: 1 | 2
      calls: number
    }> = [
      {
        budget: getPipeline9BoundedRepairBudget(1, 1, 1),
        directions: 2,
        calls: 512,
      },
      { budget: custom, directions: 1, calls: 133 },
      {
        budget: { ...custom, searchDirectionCount: 1 },
        directions: 1,
        calls: 133,
      },
      {
        budget: { ...custom, searchDirectionCount: 2 },
        directions: 2,
        calls: 133,
      },
    ]
    for (const { budget, directions, calls } of cases) {
      const fixture = createBoundedRegionalRepairFixture()
      const before = JSON.stringify({ budget, routes: fixture.routes })
      const solver = new Pipeline9BoundedRegionalRepairSolver({
        ...fixture,
        budget,
        drcEvaluator: (): ReturnType<DrcEvaluator> => [
          {
            type: "pcb_trace_error",
            pcb_trace_id: "signal",
            center: { x: 0, y: 0 },
          },
        ],
      })
      for (
        let step = 0;
        step < 2_000 &&
          !(solver.activeSubSolver instanceof NegotiateTraceClearanceSolver);
        step++
      ) {
        solver.step()
        if (solver.solved || solver.failed) {
          throw new Error("Expected an unresolved region to start negotiation")
        }
      }
      const negotiation = solver.activeSubSolver
      if (!(negotiation instanceof NegotiateTraceClearanceSolver)) {
        throw new Error("Negotiation did not start within its preparation bound")
      }
      expect(negotiation.input.searchDirectionCount).toBe(directions)
      expect(negotiation.input.maxPathSearchCalls).toBe(calls)
      expect(negotiation.input.maxPathSearchNodes).toBe(
        budget.initialMaxPathSearchNodes ?? budget.maxPathSearchNodes,
      )
      expect(negotiation.input.maxPathSearchNodesPerCall).toBe(
        budget.maxPathSearchNodesPerCall,
      )
      expect(JSON.stringify({ budget, routes: fixture.routes })).toBe(before)
    }
  },
)
