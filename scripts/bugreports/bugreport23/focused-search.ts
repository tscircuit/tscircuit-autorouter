/**
 * Focused search - tests the most promising parameter combinations faster
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
  const baseConfig = {
    SHUFFLE_SEED: 0,
    CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
    EXPANSION_DEGREES: 3,
    GREEDY_MULTIPLIER: 3,
  };

  // 1. NODE_PF_FACTOR variations (key parameter we're exploring)
  for (const npf of [
    0, 0.5, 1, 2, 5, 10, 15, 20, 25, 30, 40, 50, 75, 100, 150, 200, 500,
  ]) {
    yield {
      name: `npf_${npf}`,
      schedule: [
        { ...baseConfig, SHUFFLE_SEED: 0, NODE_PF_FACTOR: npf },
        { ...baseConfig, SHUFFLE_SEED: 1, NODE_PF_FACTOR: npf },
        {
          ...baseConfig,
          SHUFFLE_SEED: 2,
          EXPANSION_DEGREES: 4,
          NODE_PF_FACTOR: npf,
        },
      ],
    };
  }

  // 2. NPF with different GM values
  for (const npf of [10, 20, 30, 50, 100]) {
    for (const gm of [2, 2.5, 3, 3.5, 4, 5]) {
      yield {
        name: `npf${npf}_gm${gm}`,
        schedule: [
          {
            SHUFFLE_SEED: 0,
            CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
            EXPANSION_DEGREES: 3,
            GREEDY_MULTIPLIER: gm,
            NODE_PF_FACTOR: npf,
          },
          {
            SHUFFLE_SEED: 1,
            CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
            EXPANSION_DEGREES: 3,
            GREEDY_MULTIPLIER: gm,
            NODE_PF_FACTOR: npf,
          },
          {
            SHUFFLE_SEED: 2,
            CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
            EXPANSION_DEGREES: 4,
            GREEDY_MULTIPLIER: gm,
            NODE_PF_FACTOR: npf,
          },
        ],
      };
    }
  }

  // 3. NPF with different COF values
  for (const npf of [20, 50, 100]) {
    for (const cof of [0, 0.5, 1, 2]) {
      yield {
        name: `npf${npf}_cof${cof}`,
        schedule: [
          {
            SHUFFLE_SEED: 0,
            CENTER_OFFSET_DIST_PENALTY_FACTOR: cof,
            EXPANSION_DEGREES: 3,
            GREEDY_MULTIPLIER: 3,
            NODE_PF_FACTOR: npf,
          },
          {
            SHUFFLE_SEED: 1,
            CENTER_OFFSET_DIST_PENALTY_FACTOR: cof,
            EXPANSION_DEGREES: 3,
            GREEDY_MULTIPLIER: 3,
            NODE_PF_FACTOR: npf,
          },
          {
            SHUFFLE_SEED: 2,
            CENTER_OFFSET_DIST_PENALTY_FACTOR: cof,
            EXPANSION_DEGREES: 4,
            GREEDY_MULTIPLIER: 3,
            NODE_PF_FACTOR: npf,
          },
        ],
      };
    }
  }

  // 4. Fractional GM values around 3 with optimal NPF (min 1.1)
  for (const gm of [1.5, 2, 2.5, 2.7, 2.8, 2.9, 3.0, 3.1, 3.2, 3.3, 3.5, 4]) {
    yield {
      name: `fineGm_${gm}`,
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

  // 5. Different expansion degree combinations with GM=3
  for (const exp1 of [3, 4]) {
    for (const exp2 of [3, 4, 5]) {
      for (const exp3 of [4, 5, 6]) {
        yield {
          name: `exp_${exp1}_${exp2}_${exp3}`,
          schedule: [
            {
              SHUFFLE_SEED: 0,
              CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
              EXPANSION_DEGREES: exp1,
              GREEDY_MULTIPLIER: 3,
            },
            {
              SHUFFLE_SEED: 1,
              CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
              EXPANSION_DEGREES: exp2,
              GREEDY_MULTIPLIER: 3,
            },
            {
              SHUFFLE_SEED: 2,
              CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
              EXPANSION_DEGREES: exp3,
              GREEDY_MULTIPLIER: 3,
            },
          ],
        };
      }
    }
  }

  // 6. Combined: best GM with NPF exploration
  for (const npf of [30, 40, 50, 60, 70, 80]) {
    yield {
      name: `best_npf${npf}`,
      schedule: [
        {
          SHUFFLE_SEED: 0,
          CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
          EXPANSION_DEGREES: 3,
          GREEDY_MULTIPLIER: 3,
          NODE_PF_FACTOR: npf,
        },
        {
          SHUFFLE_SEED: 1,
          CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
          EXPANSION_DEGREES: 3,
          GREEDY_MULTIPLIER: 3,
          NODE_PF_FACTOR: npf,
        },
        {
          SHUFFLE_SEED: 2,
          CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
          EXPANSION_DEGREES: 4,
          GREEDY_MULTIPLIER: 3,
          NODE_PF_FACTOR: npf,
        },
      ],
    };
  }

  // 7. More seeds with best params
  for (const numSeeds of [4, 5, 6]) {
    const schedule: ScheduleEntry[] = [];
    for (let i = 0; i < numSeeds; i++) {
      schedule.push({
        SHUFFLE_SEED: i,
        CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
        EXPANSION_DEGREES: i < numSeeds - 1 ? 3 : 4,
        GREEDY_MULTIPLIER: 3,
      });
    }
    yield { name: `seeds_${numSeeds}`, schedule };
  }

  // 8. Very different NPF per entry
  yield {
    name: "varied_npf",
    schedule: [
      {
        SHUFFLE_SEED: 0,
        CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
        EXPANSION_DEGREES: 3,
        GREEDY_MULTIPLIER: 3,
        NODE_PF_FACTOR: 10,
      },
      {
        SHUFFLE_SEED: 1,
        CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
        EXPANSION_DEGREES: 3,
        GREEDY_MULTIPLIER: 3,
        NODE_PF_FACTOR: 50,
      },
      {
        SHUFFLE_SEED: 2,
        CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
        EXPANSION_DEGREES: 4,
        GREEDY_MULTIPLIER: 3,
        NODE_PF_FACTOR: 100,
      },
    ],
  };

  // 9. Low NPF to see if it helps
  for (const npf of [0.1, 0.5, 1, 2, 3, 4, 5]) {
    yield {
      name: `lowNpf_${npf}`,
      schedule: [
        {
          SHUFFLE_SEED: 0,
          CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
          EXPANSION_DEGREES: 3,
          GREEDY_MULTIPLIER: 3,
          NODE_PF_FACTOR: npf,
        },
        {
          SHUFFLE_SEED: 1,
          CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
          EXPANSION_DEGREES: 3,
          GREEDY_MULTIPLIER: 3,
          NODE_PF_FACTOR: npf,
        },
        {
          SHUFFLE_SEED: 2,
          CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
          EXPANSION_DEGREES: 4,
          GREEDY_MULTIPLIER: 3,
          NODE_PF_FACTOR: npf,
        },
      ],
    };
  }

  // 10. Higher GM with higher NPF
  for (const gm of [4, 5, 6, 8, 10]) {
    for (const npf of [50, 100, 200]) {
      yield {
        name: `highGm${gm}_npf${npf}`,
        schedule: [
          {
            SHUFFLE_SEED: 0,
            CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
            EXPANSION_DEGREES: 3,
            GREEDY_MULTIPLIER: gm,
            NODE_PF_FACTOR: npf,
          },
          {
            SHUFFLE_SEED: 1,
            CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
            EXPANSION_DEGREES: 3,
            GREEDY_MULTIPLIER: gm,
            NODE_PF_FACTOR: npf,
          },
          {
            SHUFFLE_SEED: 2,
            CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
            EXPANSION_DEGREES: 4,
            GREEDY_MULTIPLIER: gm,
            NODE_PF_FACTOR: npf,
          },
        ],
      };
    }
  }
}

async function main() {
  console.log("Focused OPTIMIZATION_SCHEDULE search for bugreport23...");
  console.log("Focus: NODE_PF_FACTOR and combination params");
  console.log("Target: Beat the current best of -65.098");
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
  let bestScore = -Infinity;
  let bestName = "";

  for (const { name, schedule } of generateSchedules()) {
    count++;
    process.stdout.write(`[${count}] Testing ${name}... `);

    try {
      const result = await runTest(schedule);
      const improvement = result.currentBoardScore - result.initialBoardScore;

      const isBest = result.currentBoardScore > bestScore;
      if (isBest) {
        bestScore = result.currentBoardScore;
        bestName = name;
      }

      console.log(
        `score: ${result.currentBoardScore.toFixed(4)}, ` +
          `improvement: ${improvement.toFixed(4)}, ` +
          `success: ${result.successfulOptimizations}` +
          (isBest ? " *** NEW BEST ***" : ""),
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

  console.log("\nTop 30 results (by currentBoardScore - higher is better):");
  console.log("-".repeat(80));
  for (let i = 0; i < Math.min(30, results.length); i++) {
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
