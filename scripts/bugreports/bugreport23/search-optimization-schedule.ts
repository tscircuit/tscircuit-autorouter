/**
 * Script to search for the best OPTIMIZATION_SCHEDULE parameters for bugreport23
 * Usage: bun run scripts/bugreports/bugreport23/search-optimization-schedule.ts
 */

import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import type { PortPointPathingHyperParameters } from "../../../lib/solvers/PortPointPathingSolver/PortPointPathingSolver";

// Type for schedule entry
type ScheduleEntry = PortPointPathingHyperParameters & {
  EXPANSION_DEGREES: number;
};

const OPTIMIZER_PATH = path.resolve(
  __dirname,
  "../../../lib/solvers/MultiSectionPortPointOptimizer/MultiSectionPortPointOptimizer.ts",
);

// Run a single test with a specific schedule
async function runTest(schedule: ScheduleEntry[]): Promise<{
  currentBoardScore: number;
  initialBoardScore: number;
  successfulOptimizations: number;
  failedOptimizations: number;
}> {
  // Read original file
  const originalContent = fs.readFileSync(OPTIMIZER_PATH, "utf-8");

  // Create modified content with new schedule
  const scheduleStr = JSON.stringify(schedule, null, 2)
    .split("\n")
    .map((line, i) => (i === 0 ? line : "  " + line))
    .join("\n");

  const modifiedContent = originalContent.replace(
    /const OPTIMIZATION_SCHEDULE[\s\S]*?\n\]/,
    `const OPTIMIZATION_SCHEDULE: (PortPointPathingHyperParameters & {
  EXPANSION_DEGREES: number
})[] = ${scheduleStr}`,
  );

  // Write modified file
  fs.writeFileSync(OPTIMIZER_PATH, modifiedContent);

  try {
    // Run test in subprocess
    return await new Promise((resolve, reject) => {
      const testScript = `
        import { AutoroutingPipelineSolver } from "./lib/solvers/AutoroutingPipelineSolver"
        import bugreport23 from "./fixtures/bug-reports/bugreport23-LGA15x4/bugreport23-LGA15x4.srj.json" with { type: "json" }

        const solver = new AutoroutingPipelineSolver(bugreport23 as any)
        solver.solveUntilPhase("highDensityRouteSolver")

        const stats = solver.multiSectionPortPointOptimizer?.stats || {}
        console.log(JSON.stringify({
          currentBoardScore: stats.currentBoardScore,
          initialBoardScore: stats.initialBoardScore,
          successfulOptimizations: stats.successfulOptimizations,
          failedOptimizations: stats.failedOptimizations,
        }))
      `;

      const child = spawn("bun", ["--eval", testScript], {
        cwd: path.resolve(__dirname, "../../.."),
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      child.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      child.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`Test failed with code ${code}: ${stderr}`));
          return;
        }

        try {
          // Find the JSON line in stdout
          const lines = stdout.trim().split("\n");
          const jsonLine = lines.find((line) => line.startsWith("{"));
          if (!jsonLine) {
            reject(new Error(`No JSON output found: ${stdout}`));
            return;
          }
          resolve(JSON.parse(jsonLine));
        } catch (e) {
          reject(new Error(`Failed to parse output: ${stdout}`));
        }
      });
    });
  } finally {
    // Restore original content
    fs.writeFileSync(OPTIMIZER_PATH, originalContent);
  }
}

// Generate different schedule configurations to test
function* generateSchedules(): Generator<{
  name: string;
  schedule: ScheduleEntry[];
}> {
  // Baseline (current schedule)
  yield {
    name: "baseline",
    schedule: [
      {
        SHUFFLE_SEED: 0,
        CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
        EXPANSION_DEGREES: 3,
      },
      {
        SHUFFLE_SEED: 1,
        CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
        EXPANSION_DEGREES: 3,
      },
      {
        SHUFFLE_SEED: 2,
        CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
        EXPANSION_DEGREES: 4,
        NODE_PF_FACTOR: 20,
        GREEDY_MULTIPLIER: 2,
      },
    ],
  };

  // Test single-entry schedules with different expansion degrees
  for (const expDeg of [2, 3, 4, 5, 6, 8]) {
    yield {
      name: `single_exp${expDeg}`,
      schedule: [
        {
          SHUFFLE_SEED: 0,
          CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
          EXPANSION_DEGREES: expDeg,
        },
      ],
    };
  }

  // Test combinations of 2 entries
  for (const exp1 of [2, 3, 4]) {
    for (const exp2 of [4, 5, 6, 8]) {
      if (exp1 >= exp2) continue;
      yield {
        name: `two_exp${exp1}_${exp2}`,
        schedule: [
          {
            SHUFFLE_SEED: 0,
            CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
            EXPANSION_DEGREES: exp1,
          },
          {
            SHUFFLE_SEED: 1,
            CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
            EXPANSION_DEGREES: exp2,
          },
        ],
      };
    }
  }

  // Test 3 entry combinations
  for (const exp3 of [4, 5, 6, 8]) {
    yield {
      name: `three_3_3_${exp3}`,
      schedule: [
        {
          SHUFFLE_SEED: 0,
          CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
          EXPANSION_DEGREES: 3,
        },
        {
          SHUFFLE_SEED: 1,
          CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
          EXPANSION_DEGREES: 3,
        },
        {
          SHUFFLE_SEED: 2,
          CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
          EXPANSION_DEGREES: exp3,
        },
      ],
    };
  }

  // Test CENTER_OFFSET_DIST_PENALTY_FACTOR
  for (const factor of [0, 0.5, 2, 5, 10]) {
    yield {
      name: `centerOffset_${factor}`,
      schedule: [
        {
          SHUFFLE_SEED: 0,
          CENTER_OFFSET_DIST_PENALTY_FACTOR: factor,
          EXPANSION_DEGREES: 3,
        },
        {
          SHUFFLE_SEED: 1,
          CENTER_OFFSET_DIST_PENALTY_FACTOR: factor,
          EXPANSION_DEGREES: 3,
        },
        {
          SHUFFLE_SEED: 2,
          CENTER_OFFSET_DIST_PENALTY_FACTOR: factor,
          EXPANSION_DEGREES: 4,
        },
      ],
    };
  }

  // Test NODE_PF_FACTOR
  for (const npf of [5, 10, 30, 50, 100]) {
    yield {
      name: `nodePf_${npf}`,
      schedule: [
        {
          SHUFFLE_SEED: 0,
          CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
          EXPANSION_DEGREES: 3,
          NODE_PF_FACTOR: npf,
        },
        {
          SHUFFLE_SEED: 1,
          CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
          EXPANSION_DEGREES: 3,
          NODE_PF_FACTOR: npf,
        },
        {
          SHUFFLE_SEED: 2,
          CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
          EXPANSION_DEGREES: 4,
          NODE_PF_FACTOR: npf,
        },
      ],
    };
  }

  // Test GREEDY_MULTIPLIER
  for (const gm of [1, 2, 3, 5, 10]) {
    yield {
      name: `greedy_${gm}`,
      schedule: [
        {
          SHUFFLE_SEED: 0,
          CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
          EXPANSION_DEGREES: 3,
          GREEDY_MULTIPLIER: gm,
        },
        {
          SHUFFLE_SEED: 1,
          CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
          EXPANSION_DEGREES: 3,
          GREEDY_MULTIPLIER: gm,
        },
        {
          SHUFFLE_SEED: 2,
          CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
          EXPANSION_DEGREES: 4,
          GREEDY_MULTIPLIER: gm,
        },
      ],
    };
  }

  // Test more seeds
  for (const numSeeds of [4, 5, 6, 8, 10]) {
    const schedule: ScheduleEntry[] = [];
    for (let i = 0; i < numSeeds; i++) {
      schedule.push({
        SHUFFLE_SEED: i,
        CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
        EXPANSION_DEGREES: i < numSeeds / 2 ? 3 : 4,
      });
    }
    yield { name: `seeds_${numSeeds}`, schedule };
  }

  // Test larger expansion degrees
  for (const maxExp of [10, 15, 20, 50, 100]) {
    yield {
      name: `largeExp_${maxExp}`,
      schedule: [
        {
          SHUFFLE_SEED: 0,
          CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
          EXPANSION_DEGREES: 3,
        },
        {
          SHUFFLE_SEED: 1,
          CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
          EXPANSION_DEGREES: 4,
        },
        {
          SHUFFLE_SEED: 2,
          CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
          EXPANSION_DEGREES: maxExp,
        },
      ],
    };
  }

  // Combined parameter tests
  for (const factor of [0, 1, 2]) {
    for (const npf of [20, 50]) {
      for (const gm of [2, 5]) {
        yield {
          name: `combo_cof${factor}_npf${npf}_gm${gm}`,
          schedule: [
            {
              SHUFFLE_SEED: 0,
              CENTER_OFFSET_DIST_PENALTY_FACTOR: factor,
              EXPANSION_DEGREES: 3,
              GREEDY_MULTIPLIER: gm,
            },
            {
              SHUFFLE_SEED: 1,
              CENTER_OFFSET_DIST_PENALTY_FACTOR: factor,
              EXPANSION_DEGREES: 3,
              GREEDY_MULTIPLIER: gm,
            },
            {
              SHUFFLE_SEED: 2,
              CENTER_OFFSET_DIST_PENALTY_FACTOR: factor,
              EXPANSION_DEGREES: 4,
              NODE_PF_FACTOR: npf,
              GREEDY_MULTIPLIER: gm,
            },
          ],
        };
      }
    }
  }

  // Test decreasing CENTER_OFFSET_DIST_PENALTY_FACTOR with large expansion
  for (const factor of [0, 0.1, 0.5]) {
    yield {
      name: `lowCenter_${factor}_largeExp`,
      schedule: [
        {
          SHUFFLE_SEED: 0,
          CENTER_OFFSET_DIST_PENALTY_FACTOR: factor,
          EXPANSION_DEGREES: 3,
        },
        {
          SHUFFLE_SEED: 1,
          CENTER_OFFSET_DIST_PENALTY_FACTOR: factor,
          EXPANSION_DEGREES: 5,
        },
        {
          SHUFFLE_SEED: 2,
          CENTER_OFFSET_DIST_PENALTY_FACTOR: factor,
          EXPANSION_DEGREES: 10,
        },
      ],
    };
  }

  // Test all zeros/minimal penalties
  yield {
    name: "minimal_penalties",
    schedule: [
      {
        SHUFFLE_SEED: 0,
        CENTER_OFFSET_DIST_PENALTY_FACTOR: 0,
        EXPANSION_DEGREES: 3,
        GREEDY_MULTIPLIER: 1,
      },
      {
        SHUFFLE_SEED: 1,
        CENTER_OFFSET_DIST_PENALTY_FACTOR: 0,
        EXPANSION_DEGREES: 4,
        GREEDY_MULTIPLIER: 1,
      },
      {
        SHUFFLE_SEED: 2,
        CENTER_OFFSET_DIST_PENALTY_FACTOR: 0,
        EXPANSION_DEGREES: 5,
        GREEDY_MULTIPLIER: 1,
      },
    ],
  };

  // High exploration (many seeds, varied expansion)
  yield {
    name: "high_exploration",
    schedule: [
      {
        SHUFFLE_SEED: 0,
        CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
        EXPANSION_DEGREES: 2,
      },
      {
        SHUFFLE_SEED: 1,
        CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
        EXPANSION_DEGREES: 3,
      },
      {
        SHUFFLE_SEED: 2,
        CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
        EXPANSION_DEGREES: 4,
      },
      {
        SHUFFLE_SEED: 3,
        CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
        EXPANSION_DEGREES: 5,
      },
      {
        SHUFFLE_SEED: 4,
        CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
        EXPANSION_DEGREES: 6,
      },
      {
        SHUFFLE_SEED: 5,
        CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
        EXPANSION_DEGREES: 8,
      },
    ],
  };

  // Aggressive greedy with high NODE_PF_FACTOR
  yield {
    name: "aggressive_greedy_highPf",
    schedule: [
      {
        SHUFFLE_SEED: 0,
        CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
        EXPANSION_DEGREES: 3,
        GREEDY_MULTIPLIER: 10,
        NODE_PF_FACTOR: 100,
      },
      {
        SHUFFLE_SEED: 1,
        CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
        EXPANSION_DEGREES: 4,
        GREEDY_MULTIPLIER: 10,
        NODE_PF_FACTOR: 100,
      },
    ],
  };
}

// Main function
async function main() {
  console.log("Starting OPTIMIZATION_SCHEDULE search for bugreport23...");
  console.log("=".repeat(80));

  const results: {
    name: string;
    schedule: ScheduleEntry[];
    currentBoardScore: number;
    initialBoardScore: number;
    improvement: number;
    successfulOptimizations: number;
  }[] = [];

  let count = 0;
  for (const { name, schedule } of generateSchedules()) {
    count++;
    process.stdout.write(`[${count}] Testing ${name}... `);

    try {
      const result = await runTest(schedule);
      const improvement = result.currentBoardScore - result.initialBoardScore;

      console.log(
        `score: ${result.currentBoardScore.toFixed(4)}, ` +
          `improvement: ${improvement.toFixed(4)}, ` +
          `success: ${result.successfulOptimizations}`,
      );

      results.push({
        name,
        schedule,
        currentBoardScore: result.currentBoardScore,
        initialBoardScore: result.initialBoardScore,
        improvement,
        successfulOptimizations: result.successfulOptimizations,
      });
    } catch (e: any) {
      console.log(`ERROR: ${e.message?.slice(0, 100)}`);
    }
  }

  console.log("\n" + "=".repeat(80));
  console.log(`Completed ${count} tests`);
  console.log("=".repeat(80));

  // Sort by currentBoardScore (higher is better)
  results.sort((a, b) => b.currentBoardScore - a.currentBoardScore);

  console.log("\nTop 20 results (by currentBoardScore - higher is better):");
  console.log("-".repeat(80));
  for (let i = 0; i < Math.min(20, results.length); i++) {
    const r = results[i];
    console.log(
      `${i + 1}. ${r.name}: score=${r.currentBoardScore.toFixed(4)}, ` +
        `improvement=${r.improvement.toFixed(4)}, success=${r.successfulOptimizations}`,
    );
  }

  console.log("\n" + "=".repeat(80));
  console.log("BEST SCHEDULE CONFIGURATION:");
  console.log("-".repeat(80));
  const best = results[0];
  console.log(`Name: ${best.name}`);
  console.log(`Score: ${best.currentBoardScore}`);
  console.log(`Improvement: ${best.improvement}`);
  console.log(`Schedule:`);
  console.log(JSON.stringify(best.schedule, null, 2));
}

main().catch(console.error);
