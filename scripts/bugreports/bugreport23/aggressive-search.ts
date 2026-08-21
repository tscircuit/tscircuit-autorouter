/**
 * Aggressive search script - explores a much wider parameter space
 * Looking for configurations that beat the current best of -65.098
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
  // Strategy 1: More entries with higher seeds
  for (const numEntries of [5, 6, 8, 10, 12]) {
    for (const gm of [3, 4, 5]) {
      const schedule: ScheduleEntry[] = [];
      for (let i = 0; i < numEntries; i++) {
        schedule.push({
          SHUFFLE_SEED: i * 100, // Spread out seeds
          CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
          EXPANSION_DEGREES: 3 + Math.floor(i * 0.5),
          GREEDY_MULTIPLIER: gm,
        });
      }
      yield { name: `multi_${numEntries}_gm${gm}`, schedule };
    }
  }

  // Strategy 2: Try different base seeds
  for (const baseSeed of [100, 200, 500, 1000, 2000, 5000]) {
    yield {
      name: `baseSeed_${baseSeed}`,
      schedule: [
        {
          SHUFFLE_SEED: baseSeed,
          CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
          EXPANSION_DEGREES: 3,
          GREEDY_MULTIPLIER: 3,
        },
        {
          SHUFFLE_SEED: baseSeed + 1,
          CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
          EXPANSION_DEGREES: 3,
          GREEDY_MULTIPLIER: 3,
        },
        {
          SHUFFLE_SEED: baseSeed + 2,
          CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
          EXPANSION_DEGREES: 4,
          GREEDY_MULTIPLIER: 3,
        },
      ],
    };
  }

  // Strategy 3: Progressive expansion with varied GM
  for (const gm of [2, 2.5, 3, 3.5, 4, 5, 6, 8]) {
    yield {
      name: `prog_gm${gm}`,
      schedule: [
        {
          SHUFFLE_SEED: 0,
          CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
          EXPANSION_DEGREES: 2,
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
        {
          SHUFFLE_SEED: 3,
          CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
          EXPANSION_DEGREES: 5,
          GREEDY_MULTIPLIER: gm,
        },
      ],
    };
  }

  // Strategy 4: Mixed GM values in schedule
  yield {
    name: "mixed_gm_ascending",
    schedule: [
      {
        SHUFFLE_SEED: 0,
        CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
        EXPANSION_DEGREES: 3,
        GREEDY_MULTIPLIER: 2,
      },
      {
        SHUFFLE_SEED: 1,
        CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
        EXPANSION_DEGREES: 3,
        GREEDY_MULTIPLIER: 3,
      },
      {
        SHUFFLE_SEED: 2,
        CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
        EXPANSION_DEGREES: 4,
        GREEDY_MULTIPLIER: 4,
      },
      {
        SHUFFLE_SEED: 3,
        CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
        EXPANSION_DEGREES: 4,
        GREEDY_MULTIPLIER: 5,
      },
    ],
  };

  yield {
    name: "mixed_gm_descending",
    schedule: [
      {
        SHUFFLE_SEED: 0,
        CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
        EXPANSION_DEGREES: 3,
        GREEDY_MULTIPLIER: 5,
      },
      {
        SHUFFLE_SEED: 1,
        CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
        EXPANSION_DEGREES: 3,
        GREEDY_MULTIPLIER: 4,
      },
      {
        SHUFFLE_SEED: 2,
        CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
        EXPANSION_DEGREES: 4,
        GREEDY_MULTIPLIER: 3,
      },
      {
        SHUFFLE_SEED: 3,
        CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
        EXPANSION_DEGREES: 4,
        GREEDY_MULTIPLIER: 2,
      },
    ],
  };

  // Strategy 5: Very high greedy values
  for (const gm of [10, 15, 20, 30, 50]) {
    yield {
      name: `highGreedy_${gm}`,
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

  // Strategy 6: Very low greedy values (more thorough search)
  for (const gm of [0.5, 0.75, 1, 1.25, 1.5, 1.75]) {
    yield {
      name: `lowGreedy_${gm}`,
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

  // Strategy 7: Different NODE_PF_FACTOR values with GM=3
  for (const npf of [1, 5, 10, 20, 30, 50, 100, 200]) {
    yield {
      name: `npf_${npf}`,
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

  // Strategy 8: Larger expansion degrees
  for (const maxExp of [6, 8, 10, 12, 15, 20]) {
    yield {
      name: `bigExp_${maxExp}`,
      schedule: [
        {
          SHUFFLE_SEED: 0,
          CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
          EXPANSION_DEGREES: 3,
          GREEDY_MULTIPLIER: 3,
        },
        {
          SHUFFLE_SEED: 1,
          CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
          EXPANSION_DEGREES: Math.ceil(maxExp / 2),
          GREEDY_MULTIPLIER: 3,
        },
        {
          SHUFFLE_SEED: 2,
          CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
          EXPANSION_DEGREES: maxExp,
          GREEDY_MULTIPLIER: 3,
        },
      ],
    };
  }

  // Strategy 9: All same expansion degree
  for (const exp of [3, 4, 5, 6]) {
    yield {
      name: `sameExp_${exp}`,
      schedule: [
        {
          SHUFFLE_SEED: 0,
          CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
          EXPANSION_DEGREES: exp,
          GREEDY_MULTIPLIER: 3,
        },
        {
          SHUFFLE_SEED: 1,
          CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
          EXPANSION_DEGREES: exp,
          GREEDY_MULTIPLIER: 3,
        },
        {
          SHUFFLE_SEED: 2,
          CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
          EXPANSION_DEGREES: exp,
          GREEDY_MULTIPLIER: 3,
        },
      ],
    };
  }

  // Strategy 10: Long schedule with many seeds (same params)
  for (const numSeeds of [15, 20, 30]) {
    const schedule: ScheduleEntry[] = [];
    for (let i = 0; i < numSeeds; i++) {
      schedule.push({
        SHUFFLE_SEED: i,
        CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
        EXPANSION_DEGREES: 3,
        GREEDY_MULTIPLIER: 3,
      });
    }
    yield { name: `manySeeds_${numSeeds}`, schedule };
  }

  // Strategy 11: Very varied expansion
  yield {
    name: "varied_exp_wide",
    schedule: [
      {
        SHUFFLE_SEED: 0,
        CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
        EXPANSION_DEGREES: 2,
        GREEDY_MULTIPLIER: 3,
      },
      {
        SHUFFLE_SEED: 1,
        CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
        EXPANSION_DEGREES: 4,
        GREEDY_MULTIPLIER: 3,
      },
      {
        SHUFFLE_SEED: 2,
        CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
        EXPANSION_DEGREES: 6,
        GREEDY_MULTIPLIER: 3,
      },
      {
        SHUFFLE_SEED: 3,
        CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
        EXPANSION_DEGREES: 8,
        GREEDY_MULTIPLIER: 3,
      },
      {
        SHUFFLE_SEED: 4,
        CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
        EXPANSION_DEGREES: 10,
        GREEDY_MULTIPLIER: 3,
      },
    ],
  };

  // Strategy 12: Zero CENTER_OFFSET_DIST_PENALTY_FACTOR with various GM
  for (const gm of [2, 2.5, 3, 3.5, 4, 5]) {
    yield {
      name: `zeroCof_gm${gm}`,
      schedule: [
        {
          SHUFFLE_SEED: 0,
          CENTER_OFFSET_DIST_PENALTY_FACTOR: 0,
          EXPANSION_DEGREES: 3,
          GREEDY_MULTIPLIER: gm,
        },
        {
          SHUFFLE_SEED: 1,
          CENTER_OFFSET_DIST_PENALTY_FACTOR: 0,
          EXPANSION_DEGREES: 3,
          GREEDY_MULTIPLIER: gm,
        },
        {
          SHUFFLE_SEED: 2,
          CENTER_OFFSET_DIST_PENALTY_FACTOR: 0,
          EXPANSION_DEGREES: 4,
          GREEDY_MULTIPLIER: gm,
        },
      ],
    };
  }

  // Strategy 13: Single entry schedules with different params
  for (const exp of [3, 4, 5, 6, 8]) {
    for (const gm of [2, 3, 4, 5]) {
      yield {
        name: `single_exp${exp}_gm${gm}`,
        schedule: [
          {
            SHUFFLE_SEED: 0,
            CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
            EXPANSION_DEGREES: exp,
            GREEDY_MULTIPLIER: gm,
          },
        ],
      };
    }
  }

  // Strategy 14: Two entries with optimal params variations
  for (const gm of [2.5, 3, 3.5, 4]) {
    for (const exp2 of [3, 4, 5, 6]) {
      yield {
        name: `two_gm${gm}_exp3_${exp2}`,
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
            EXPANSION_DEGREES: exp2,
            GREEDY_MULTIPLIER: gm,
          },
        ],
      };
    }
  }

  // Strategy 15: Higher COF values
  for (const cof of [2, 3, 5, 10]) {
    yield {
      name: `highCof_${cof}`,
      schedule: [
        {
          SHUFFLE_SEED: 0,
          CENTER_OFFSET_DIST_PENALTY_FACTOR: cof,
          EXPANSION_DEGREES: 3,
          GREEDY_MULTIPLIER: 3,
        },
        {
          SHUFFLE_SEED: 1,
          CENTER_OFFSET_DIST_PENALTY_FACTOR: cof,
          EXPANSION_DEGREES: 3,
          GREEDY_MULTIPLIER: 3,
        },
        {
          SHUFFLE_SEED: 2,
          CENTER_OFFSET_DIST_PENALTY_FACTOR: cof,
          EXPANSION_DEGREES: 4,
          GREEDY_MULTIPLIER: 3,
        },
      ],
    };
  }

  // Strategy 16: Mixed COF values
  yield {
    name: "mixed_cof",
    schedule: [
      {
        SHUFFLE_SEED: 0,
        CENTER_OFFSET_DIST_PENALTY_FACTOR: 0,
        EXPANSION_DEGREES: 3,
        GREEDY_MULTIPLIER: 3,
      },
      {
        SHUFFLE_SEED: 1,
        CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
        EXPANSION_DEGREES: 3,
        GREEDY_MULTIPLIER: 3,
      },
      {
        SHUFFLE_SEED: 2,
        CENTER_OFFSET_DIST_PENALTY_FACTOR: 2,
        EXPANSION_DEGREES: 4,
        GREEDY_MULTIPLIER: 3,
      },
    ],
  };

  // Strategy 17: Fractional GM values fine-tuning around 3
  for (const gm of [2.6, 2.7, 2.8, 2.9, 3.1, 3.2, 3.3, 3.4]) {
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

  // Strategy 18: Large schedule with increasing expansion
  yield {
    name: "large_increasing",
    schedule: Array.from({ length: 8 }, (_, i) => ({
      SHUFFLE_SEED: i,
      CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
      EXPANSION_DEGREES: 3 + i,
      GREEDY_MULTIPLIER: 3,
    })),
  };

  // Strategy 19: Best config with different starting seeds
  for (const startSeed of [10, 50, 100, 500, 1000]) {
    yield {
      name: `bestWithSeed_${startSeed}`,
      schedule: [
        {
          SHUFFLE_SEED: startSeed,
          CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
          EXPANSION_DEGREES: 3,
          GREEDY_MULTIPLIER: 3,
        },
        {
          SHUFFLE_SEED: startSeed + 1,
          CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
          EXPANSION_DEGREES: 3,
          GREEDY_MULTIPLIER: 3,
        },
        {
          SHUFFLE_SEED: startSeed + 2,
          CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
          EXPANSION_DEGREES: 4,
          GREEDY_MULTIPLIER: 3,
        },
      ],
    };
  }

  // Strategy 20: Extreme params
  yield {
    name: "extreme_greedy",
    schedule: [
      {
        SHUFFLE_SEED: 0,
        CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
        EXPANSION_DEGREES: 3,
        GREEDY_MULTIPLIER: 100,
      },
    ],
  };

  yield {
    name: "extreme_npf",
    schedule: [
      {
        SHUFFLE_SEED: 0,
        CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
        EXPANSION_DEGREES: 3,
        GREEDY_MULTIPLIER: 3,
        NODE_PF_FACTOR: 1000,
      },
      {
        SHUFFLE_SEED: 1,
        CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
        EXPANSION_DEGREES: 3,
        GREEDY_MULTIPLIER: 3,
        NODE_PF_FACTOR: 1000,
      },
      {
        SHUFFLE_SEED: 2,
        CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
        EXPANSION_DEGREES: 4,
        GREEDY_MULTIPLIER: 3,
        NODE_PF_FACTOR: 1000,
      },
    ],
  };
}

async function main() {
  console.log("Aggressive OPTIMIZATION_SCHEDULE search for bugreport23...");
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
