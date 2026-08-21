/**
 * Fine-tuning script - focused search around the best parameters
 * Based on initial results: GREEDY_MULTIPLIER=3, CENTER_OFFSET_DIST_PENALTY_FACTOR=0 or low
 */

import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import type { PortPointPathingHyperParameters } from "../../../lib/solvers/PortPointPathingSolver/PortPointPathingSolver";

type ScheduleEntry = PortPointPathingHyperParameters & {
  EXPANSION_DEGREES: number;
};

const OPTIMIZER_PATH = path.resolve(
  __dirname,
  "../../../lib/solvers/MultiSectionPortPointOptimizer/MultiSectionPortPointOptimizer.ts",
);

async function runTest(schedule: ScheduleEntry[]): Promise<{
  currentBoardScore: number;
  initialBoardScore: number;
  successfulOptimizations: number;
  failedOptimizations: number;
}> {
  const originalContent = fs.readFileSync(OPTIMIZER_PATH, "utf-8");

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

  fs.writeFileSync(OPTIMIZER_PATH, modifiedContent);

  try {
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
    fs.writeFileSync(OPTIMIZER_PATH, originalContent);
  }
}

function* generateSchedules(): Generator<{
  name: string;
  schedule: ScheduleEntry[];
}> {
  // Best from initial search: greedy_3 with GREEDY_MULTIPLIER=3
  // Let's fine-tune around GREEDY_MULTIPLIER=3 with different CENTER_OFFSET_DIST_PENALTY_FACTOR values

  // Test GREEDY_MULTIPLIER values around 3
  for (const gm of [2.5, 3, 3.5, 4]) {
    for (const cof of [0, 0.25, 0.5, 1]) {
      yield {
        name: `gm${gm}_cof${cof}`,
        schedule: [
          {
            SHUFFLE_SEED: 0,
            CENTER_OFFSET_DIST_PENALTY_FACTOR: cof,
            EXPANSION_DEGREES: 3,
            GREEDY_MULTIPLIER: gm,
          },
          {
            SHUFFLE_SEED: 1,
            CENTER_OFFSET_DIST_PENALTY_FACTOR: cof,
            EXPANSION_DEGREES: 3,
            GREEDY_MULTIPLIER: gm,
          },
          {
            SHUFFLE_SEED: 2,
            CENTER_OFFSET_DIST_PENALTY_FACTOR: cof,
            EXPANSION_DEGREES: 4,
            GREEDY_MULTIPLIER: gm,
          },
        ],
      };
    }
  }

  // Test with different NODE_PF_FACTOR around optimal
  for (const npf of [10, 20, 30, 50]) {
    yield {
      name: `gm3_cof0_npf${npf}`,
      schedule: [
        {
          SHUFFLE_SEED: 0,
          CENTER_OFFSET_DIST_PENALTY_FACTOR: 0,
          EXPANSION_DEGREES: 3,
          GREEDY_MULTIPLIER: 3,
          NODE_PF_FACTOR: npf,
        },
        {
          SHUFFLE_SEED: 1,
          CENTER_OFFSET_DIST_PENALTY_FACTOR: 0,
          EXPANSION_DEGREES: 3,
          GREEDY_MULTIPLIER: 3,
          NODE_PF_FACTOR: npf,
        },
        {
          SHUFFLE_SEED: 2,
          CENTER_OFFSET_DIST_PENALTY_FACTOR: 0,
          EXPANSION_DEGREES: 4,
          GREEDY_MULTIPLIER: 3,
          NODE_PF_FACTOR: npf,
        },
      ],
    };
  }

  // Test different expansion degree combinations
  for (const exp1 of [2, 3, 4]) {
    for (const exp2 of [3, 4, 5]) {
      for (const exp3 of [4, 5, 6]) {
        if (exp1 > exp2 || exp2 > exp3) continue;
        yield {
          name: `gm3_exp${exp1}_${exp2}_${exp3}`,
          schedule: [
            {
              SHUFFLE_SEED: 0,
              CENTER_OFFSET_DIST_PENALTY_FACTOR: 0,
              EXPANSION_DEGREES: exp1,
              GREEDY_MULTIPLIER: 3,
            },
            {
              SHUFFLE_SEED: 1,
              CENTER_OFFSET_DIST_PENALTY_FACTOR: 0,
              EXPANSION_DEGREES: exp2,
              GREEDY_MULTIPLIER: 3,
            },
            {
              SHUFFLE_SEED: 2,
              CENTER_OFFSET_DIST_PENALTY_FACTOR: 0,
              EXPANSION_DEGREES: exp3,
              GREEDY_MULTIPLIER: 3,
            },
          ],
        };
      }
    }
  }

  // Test 4-entry and 5-entry schedules
  for (const numEntries of [4, 5, 6]) {
    const schedule: ScheduleEntry[] = [];
    for (let i = 0; i < numEntries; i++) {
      schedule.push({
        SHUFFLE_SEED: i,
        CENTER_OFFSET_DIST_PENALTY_FACTOR: 0,
        EXPANSION_DEGREES: 3 + Math.floor(i / 2),
        GREEDY_MULTIPLIER: 3,
      });
    }
    yield { name: `gm3_entries${numEntries}`, schedule };
  }

  // Test combined optimal params with different shuffle seeds
  for (const maxSeed of [3, 4, 5, 6, 8]) {
    const schedule: ScheduleEntry[] = [];
    for (let i = 0; i < maxSeed; i++) {
      schedule.push({
        SHUFFLE_SEED: i,
        CENTER_OFFSET_DIST_PENALTY_FACTOR: 0,
        EXPANSION_DEGREES: 3,
        GREEDY_MULTIPLIER: 3,
      });
    }
    yield { name: `gm3_cof0_seeds${maxSeed}`, schedule };
  }

  // Test with varying expansion degrees, all low COF and GM=3
  yield {
    name: "gm3_cof0_varied_exp",
    schedule: [
      {
        SHUFFLE_SEED: 0,
        CENTER_OFFSET_DIST_PENALTY_FACTOR: 0,
        EXPANSION_DEGREES: 2,
        GREEDY_MULTIPLIER: 3,
      },
      {
        SHUFFLE_SEED: 1,
        CENTER_OFFSET_DIST_PENALTY_FACTOR: 0,
        EXPANSION_DEGREES: 3,
        GREEDY_MULTIPLIER: 3,
      },
      {
        SHUFFLE_SEED: 2,
        CENTER_OFFSET_DIST_PENALTY_FACTOR: 0,
        EXPANSION_DEGREES: 4,
        GREEDY_MULTIPLIER: 3,
      },
      {
        SHUFFLE_SEED: 3,
        CENTER_OFFSET_DIST_PENALTY_FACTOR: 0,
        EXPANSION_DEGREES: 5,
        GREEDY_MULTIPLIER: 3,
      },
    ],
  };

  // Test with GM=3.5 which might be even better
  for (const exp of [3, 4, 5]) {
    yield {
      name: `gm3.5_cof0_exp${exp}`,
      schedule: [
        {
          SHUFFLE_SEED: 0,
          CENTER_OFFSET_DIST_PENALTY_FACTOR: 0,
          EXPANSION_DEGREES: exp,
          GREEDY_MULTIPLIER: 3.5,
        },
        {
          SHUFFLE_SEED: 1,
          CENTER_OFFSET_DIST_PENALTY_FACTOR: 0,
          EXPANSION_DEGREES: exp,
          GREEDY_MULTIPLIER: 3.5,
        },
        {
          SHUFFLE_SEED: 2,
          CENTER_OFFSET_DIST_PENALTY_FACTOR: 0,
          EXPANSION_DEGREES: exp + 1,
          GREEDY_MULTIPLIER: 3.5,
        },
      ],
    };
  }

  // Some potentially good combinations
  yield {
    name: "optimal_combo_v1",
    schedule: [
      {
        SHUFFLE_SEED: 0,
        CENTER_OFFSET_DIST_PENALTY_FACTOR: 0,
        EXPANSION_DEGREES: 3,
        GREEDY_MULTIPLIER: 3,
        NODE_PF_FACTOR: 30,
      },
      {
        SHUFFLE_SEED: 1,
        CENTER_OFFSET_DIST_PENALTY_FACTOR: 0,
        EXPANSION_DEGREES: 3,
        GREEDY_MULTIPLIER: 3,
        NODE_PF_FACTOR: 30,
      },
      {
        SHUFFLE_SEED: 2,
        CENTER_OFFSET_DIST_PENALTY_FACTOR: 0,
        EXPANSION_DEGREES: 4,
        GREEDY_MULTIPLIER: 3,
        NODE_PF_FACTOR: 30,
      },
    ],
  };

  yield {
    name: "optimal_combo_v2",
    schedule: [
      {
        SHUFFLE_SEED: 0,
        CENTER_OFFSET_DIST_PENALTY_FACTOR: 0,
        EXPANSION_DEGREES: 3,
        GREEDY_MULTIPLIER: 3,
      },
      {
        SHUFFLE_SEED: 1,
        CENTER_OFFSET_DIST_PENALTY_FACTOR: 0,
        EXPANSION_DEGREES: 4,
        GREEDY_MULTIPLIER: 3,
      },
      {
        SHUFFLE_SEED: 2,
        CENTER_OFFSET_DIST_PENALTY_FACTOR: 0,
        EXPANSION_DEGREES: 5,
        GREEDY_MULTIPLIER: 3,
      },
      {
        SHUFFLE_SEED: 3,
        CENTER_OFFSET_DIST_PENALTY_FACTOR: 0,
        EXPANSION_DEGREES: 6,
        GREEDY_MULTIPLIER: 3,
      },
    ],
  };

  yield {
    name: "optimal_combo_v3",
    schedule: [
      {
        SHUFFLE_SEED: 0,
        CENTER_OFFSET_DIST_PENALTY_FACTOR: 0.5,
        EXPANSION_DEGREES: 3,
        GREEDY_MULTIPLIER: 3.5,
      },
      {
        SHUFFLE_SEED: 1,
        CENTER_OFFSET_DIST_PENALTY_FACTOR: 0.5,
        EXPANSION_DEGREES: 3,
        GREEDY_MULTIPLIER: 3.5,
      },
      {
        SHUFFLE_SEED: 2,
        CENTER_OFFSET_DIST_PENALTY_FACTOR: 0.5,
        EXPANSION_DEGREES: 4,
        GREEDY_MULTIPLIER: 3.5,
      },
    ],
  };
}

async function main() {
  console.log("Fine-tuning OPTIMIZATION_SCHEDULE search for bugreport23...");
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
