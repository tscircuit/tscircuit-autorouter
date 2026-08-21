/**
 * Safe search - tests parameters inline without modifying source files
 * Uses a direct test approach with proper backup/restore
 */

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import type { PortPointPathingHyperParameters } from "../../../lib/solvers/PortPointPathingSolver/PortPointPathingSolver";

type ScheduleEntry = PortPointPathingHyperParameters & {
  EXPANSION_DEGREES: number;
};

const OPTIMIZER_PATH = path.resolve(
  __dirname,
  "../../../lib/solvers/MultiSectionPortPointOptimizer/MultiSectionPortPointOptimizer.ts",
);

// Store original content at startup
const ORIGINAL_CONTENT = fs.readFileSync(OPTIMIZER_PATH, "utf-8");

// Restore on exit
process.on("exit", () => {
  fs.writeFileSync(OPTIMIZER_PATH, ORIGINAL_CONTENT);
  console.log("\nRestored original file on exit");
});
process.on("SIGINT", () => {
  fs.writeFileSync(OPTIMIZER_PATH, ORIGINAL_CONTENT);
  console.log("\nRestored original file on interrupt");
  process.exit(1);
});
process.on("SIGTERM", () => {
  fs.writeFileSync(OPTIMIZER_PATH, ORIGINAL_CONTENT);
  process.exit(1);
});

function runTest(schedule: ScheduleEntry[]): {
  currentBoardScore: number;
  initialBoardScore: number;
  successfulOptimizations: number;
} | null {
  const scheduleStr = JSON.stringify(schedule, null, 2)
    .split("\n")
    .map((line, i) => (i === 0 ? line : "  " + line))
    .join("\n");

  const modifiedContent = ORIGINAL_CONTENT.replace(
    /const OPTIMIZATION_SCHEDULE[\s\S]*?\n\]/,
    `const OPTIMIZATION_SCHEDULE: (PortPointPathingHyperParameters & {
  EXPANSION_DEGREES: number
})[] = ${scheduleStr}`,
  );

  fs.writeFileSync(OPTIMIZER_PATH, modifiedContent);

  try {
    const result = execSync(
      `bun --eval "
        import { AutoroutingPipelineSolver } from './lib/solvers/AutoroutingPipelineSolver'
        import bugreport23 from './fixtures/bug-reports/bugreport23-LGA15x4/bugreport23-LGA15x4.srj.json' with { type: "json" }
        const solver = new AutoroutingPipelineSolver(bugreport23 as any)
        solver.solveUntilPhase('highDensityRouteSolver')
        const stats = solver.multiSectionPortPointOptimizer?.stats || {}
        console.log(JSON.stringify({
          currentBoardScore: stats.currentBoardScore,
          initialBoardScore: stats.initialBoardScore,
          successfulOptimizations: stats.successfulOptimizations,
        }))
      "`,
      {
        cwd: path.resolve(__dirname, "../../.."),
        encoding: "utf-8",
        timeout: 60000,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    const lines = result.trim().split("\n");
    const jsonLine = lines.find((line) => line.startsWith("{"));
    if (jsonLine) {
      return JSON.parse(jsonLine);
    }
  } catch (e: any) {
    // Ignore errors, return null
  }
  return null;
}

// Generate test configurations - GREEDY_MULTIPLIER >= 1.1
const schedules: { name: string; schedule: ScheduleEntry[] }[] = [];

// Base config
const base = {
  SHUFFLE_SEED: 0,
  CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
  EXPANSION_DEGREES: 3,
  GREEDY_MULTIPLIER: 3,
};

// 1. NODE_PF_FACTOR variations
for (const npf of [10, 20, 30, 40, 50, 60, 70, 80, 100, 150, 200]) {
  schedules.push({
    name: `npf_${npf}`,
    schedule: [
      { ...base, SHUFFLE_SEED: 0, NODE_PF_FACTOR: npf },
      { ...base, SHUFFLE_SEED: 1, NODE_PF_FACTOR: npf },
      { ...base, SHUFFLE_SEED: 2, EXPANSION_DEGREES: 4, NODE_PF_FACTOR: npf },
    ],
  });
}

// 2. GREEDY_MULTIPLIER variations (>= 1.1)
for (const gm of [1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 8, 10]) {
  schedules.push({
    name: `gm_${gm}`,
    schedule: [
      { ...base, SHUFFLE_SEED: 0, GREEDY_MULTIPLIER: gm },
      { ...base, SHUFFLE_SEED: 1, GREEDY_MULTIPLIER: gm },
      { ...base, SHUFFLE_SEED: 2, EXPANSION_DEGREES: 4, GREEDY_MULTIPLIER: gm },
    ],
  });
}

// 3. CENTER_OFFSET_DIST_PENALTY_FACTOR variations
for (const cof of [0, 0.5, 1, 2, 3, 5]) {
  schedules.push({
    name: `cof_${cof}`,
    schedule: [
      { ...base, SHUFFLE_SEED: 0, CENTER_OFFSET_DIST_PENALTY_FACTOR: cof },
      { ...base, SHUFFLE_SEED: 1, CENTER_OFFSET_DIST_PENALTY_FACTOR: cof },
      {
        ...base,
        SHUFFLE_SEED: 2,
        EXPANSION_DEGREES: 4,
        CENTER_OFFSET_DIST_PENALTY_FACTOR: cof,
      },
    ],
  });
}

// 4. Expansion degree variations
for (const exp of [2, 3, 4, 5, 6, 8]) {
  schedules.push({
    name: `exp_${exp}`,
    schedule: [
      { ...base, SHUFFLE_SEED: 0, EXPANSION_DEGREES: exp },
      { ...base, SHUFFLE_SEED: 1, EXPANSION_DEGREES: exp },
      { ...base, SHUFFLE_SEED: 2, EXPANSION_DEGREES: exp + 1 },
    ],
  });
}

// 5. Combined: Best GM with NPF
for (const npf of [30, 50, 70, 100]) {
  for (const gm of [2.5, 3, 3.5, 4]) {
    schedules.push({
      name: `gm${gm}_npf${npf}`,
      schedule: [
        {
          ...base,
          SHUFFLE_SEED: 0,
          GREEDY_MULTIPLIER: gm,
          NODE_PF_FACTOR: npf,
        },
        {
          ...base,
          SHUFFLE_SEED: 1,
          GREEDY_MULTIPLIER: gm,
          NODE_PF_FACTOR: npf,
        },
        {
          ...base,
          SHUFFLE_SEED: 2,
          EXPANSION_DEGREES: 4,
          GREEDY_MULTIPLIER: gm,
          NODE_PF_FACTOR: npf,
        },
      ],
    });
  }
}

// 6. Combined: COF with GM
for (const cof of [0, 0.5, 1]) {
  for (const gm of [2.5, 3, 3.5]) {
    schedules.push({
      name: `cof${cof}_gm${gm}`,
      schedule: [
        {
          ...base,
          SHUFFLE_SEED: 0,
          CENTER_OFFSET_DIST_PENALTY_FACTOR: cof,
          GREEDY_MULTIPLIER: gm,
        },
        {
          ...base,
          SHUFFLE_SEED: 1,
          CENTER_OFFSET_DIST_PENALTY_FACTOR: cof,
          GREEDY_MULTIPLIER: gm,
        },
        {
          ...base,
          SHUFFLE_SEED: 2,
          EXPANSION_DEGREES: 4,
          CENTER_OFFSET_DIST_PENALTY_FACTOR: cof,
          GREEDY_MULTIPLIER: gm,
        },
      ],
    });
  }
}

// 7. Triple param combo
for (const npf of [50, 100]) {
  for (const gm of [3, 4]) {
    for (const cof of [0, 1]) {
      schedules.push({
        name: `npf${npf}_gm${gm}_cof${cof}`,
        schedule: [
          {
            ...base,
            SHUFFLE_SEED: 0,
            NODE_PF_FACTOR: npf,
            GREEDY_MULTIPLIER: gm,
            CENTER_OFFSET_DIST_PENALTY_FACTOR: cof,
          },
          {
            ...base,
            SHUFFLE_SEED: 1,
            NODE_PF_FACTOR: npf,
            GREEDY_MULTIPLIER: gm,
            CENTER_OFFSET_DIST_PENALTY_FACTOR: cof,
          },
          {
            ...base,
            SHUFFLE_SEED: 2,
            EXPANSION_DEGREES: 4,
            NODE_PF_FACTOR: npf,
            GREEDY_MULTIPLIER: gm,
            CENTER_OFFSET_DIST_PENALTY_FACTOR: cof,
          },
        ],
      });
    }
  }
}

// 8. More seeds
for (const numSeeds of [4, 5, 6, 8]) {
  const schedule: ScheduleEntry[] = [];
  for (let i = 0; i < numSeeds; i++) {
    schedule.push({
      SHUFFLE_SEED: i,
      CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
      EXPANSION_DEGREES: i < numSeeds - 1 ? 3 : 4,
      GREEDY_MULTIPLIER: 3,
    });
  }
  schedules.push({ name: `seeds_${numSeeds}`, schedule });
}

// Run tests
console.log("Safe OPTIMIZATION_SCHEDULE search for bugreport23");
console.log("=".repeat(70));
console.log(`Testing ${schedules.length} configurations...`);
console.log("");

const results: {
  name: string;
  schedule: ScheduleEntry[];
  score: number;
  improvement: number;
  success: number;
}[] = [];

let bestScore = -Infinity;

for (let i = 0; i < schedules.length; i++) {
  const { name, schedule } = schedules[i];
  process.stdout.write(`[${i + 1}/${schedules.length}] ${name.padEnd(25)} `);

  const result = runTest(schedule);
  if (result) {
    const improvement = result.currentBoardScore - result.initialBoardScore;
    const isBest = result.currentBoardScore > bestScore;
    if (isBest) bestScore = result.currentBoardScore;

    console.log(
      `score: ${result.currentBoardScore.toFixed(4)}, ` +
        `imp: ${improvement.toFixed(4)}, ` +
        `succ: ${result.successfulOptimizations}` +
        (isBest ? " ***BEST***" : ""),
    );

    results.push({
      name,
      schedule,
      score: result.currentBoardScore,
      improvement,
      success: result.successfulOptimizations,
    });
  } else {
    console.log("ERROR");
  }
}

// Restore original
fs.writeFileSync(OPTIMIZER_PATH, ORIGINAL_CONTENT);

// Results
console.log("\n" + "=".repeat(70));
results.sort((a, b) => b.score - a.score);

console.log("Top 20 results:");
console.log("-".repeat(70));
for (let i = 0; i < Math.min(20, results.length); i++) {
  const r = results[i];
  console.log(
    `${(i + 1).toString().padStart(2)}. ${r.name.padEnd(25)} score=${r.score.toFixed(4)} imp=${r.improvement.toFixed(4)}`,
  );
}

console.log("\n" + "=".repeat(70));
console.log("BEST CONFIG:");
const best = results[0];
console.log(`Name: ${best.name}`);
console.log(`Score: ${best.score}`);
console.log("Schedule:");
console.log(JSON.stringify(best.schedule, null, 2));
