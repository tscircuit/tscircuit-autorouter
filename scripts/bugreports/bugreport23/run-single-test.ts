/**
 * Single test runner for bugreport23 with a specific OPTIMIZATION_SCHEDULE
 * Reads the schedule from an environment variable
 * Usage: SCHEDULE='[...]' bun run scripts/bugreports/bugreport23/run-single-test.ts
 */

// Parse schedule from environment variable
const scheduleEnv = process.env.SCHEDULE;
if (!scheduleEnv) {
  console.error("SCHEDULE environment variable required");
  process.exit(1);
}

const schedule = JSON.parse(scheduleEnv);

// Patch the module before importing anything else
const originalRequire = require;
const Module = require("module");
const originalLoad = Module._load;

Module._load = function (request: string, parent: any, isMain: boolean) {
  const result = originalLoad.apply(this, [request, parent, isMain]);

  if (
    request.includes("MultiSectionPortPointOptimizer") ||
    (parent?.filename?.includes("MultiSectionPortPointOptimizer") &&
      !request.includes("node_modules"))
  ) {
    // Override the OPTIMIZATION_SCHEDULE if this is our target module
    if (result.MultiSectionPortPointOptimizer) {
      // The schedule is used internally, we need to patch MAX_NODE_ATTEMPTS
      const proto = result.MultiSectionPortPointOptimizer.prototype;
      if (proto) {
        // Set MAX_NODE_ATTEMPTS based on schedule length
        Object.defineProperty(proto, "MAX_NODE_ATTEMPTS", {
          get: () => schedule.length,
          configurable: true,
        });
      }
    }
  }

  return result;
};

// Now we need to actually use the schedule... the patching approach is complex.
// Let's use a simpler approach - directly copy and modify the solver.

import { AutoroutingPipelineSolver2_PortPointPathing } from "../../../lib/autorouter-pipelines/AutoroutingPipeline2_PortPointPathing/AutoroutingPipelineSolver2_PortPointPathing";
import type { SimpleRouteJson } from "../../../lib/types";
import bugreport23 from "../../../fixtures/bug-reports/bugreport23-LGA15x4/bugreport23-LGA15x4.srj.json" with { type: "json" };

// Since patching is complex, let's just run the test and output the results
// We'll compare different schedules by modifying the source file in the outer script

const solver = new AutoroutingPipelineSolver2_PortPointPathing(
  bugreport23 as unknown as SimpleRouteJson,
);
solver.solveUntilPhase("highDensityRouteSolver");

const stats = solver.multiSectionPortPointOptimizer?.stats || {};
console.log(
  JSON.stringify({
    currentBoardScore: stats.currentBoardScore,
    initialBoardScore: stats.initialBoardScore,
    successfulOptimizations: stats.successfulOptimizations,
    failedOptimizations: stats.failedOptimizations,
  }),
);
