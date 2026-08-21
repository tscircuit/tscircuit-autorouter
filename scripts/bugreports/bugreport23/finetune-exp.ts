/**
 * Fine-tune around the best expansion degree finding (exp=6)
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

const ORIGINAL_CONTENT = fs.readFileSync(OPTIMIZER_PATH, "utf-8");

process.on("exit", () => {
  fs.writeFileSync(OPTIMIZER_PATH, ORIGINAL_CONTENT);
  console.log("\nRestored original file");
});
process.on("SIGINT", () => {
  fs.writeFileSync(OPTIMIZER_PATH, ORIGINAL_CONTENT);
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
        timeout: 120000,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    const lines = result.trim().split("\n");
    const jsonLine = lines.find((line) => line.startsWith("{"));
    if (jsonLine) {
      return JSON.parse(jsonLine);
    }
  } catch (e: any) {
    // Ignore errors
  }
  return null;
}

const schedules: { name: string; schedule: ScheduleEntry[] }[] = [];

// Base: GM=3, COF=1 (proven good)
const base = {
  CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
  GREEDY_MULTIPLIER: 3,
};

// 1. Test expansion degrees around 6
for (const exp of [5, 6, 7, 8, 9, 10, 12, 15]) {
  schedules.push({
    name: `exp_same_${exp}`,
    schedule: [
      { SHUFFLE_SEED: 0, ...base, EXPANSION_DEGREES: exp },
      { SHUFFLE_SEED: 1, ...base, EXPANSION_DEGREES: exp },
      { SHUFFLE_SEED: 2, ...base, EXPANSION_DEGREES: exp + 1 },
    ],
  });
}

// 2. Various expansion patterns
for (const exp1 of [5, 6, 7]) {
  for (const exp2 of [6, 7, 8]) {
    for (const exp3 of [7, 8, 9, 10]) {
      if (exp1 > exp2 || exp2 > exp3) continue;
      schedules.push({
        name: `exp_${exp1}_${exp2}_${exp3}`,
        schedule: [
          { SHUFFLE_SEED: 0, ...base, EXPANSION_DEGREES: exp1 },
          { SHUFFLE_SEED: 1, ...base, EXPANSION_DEGREES: exp2 },
          { SHUFFLE_SEED: 2, ...base, EXPANSION_DEGREES: exp3 },
        ],
      });
    }
  }
}

// 3. Starting from small then expanding
for (const startExp of [3, 4, 5]) {
  for (const endExp of [6, 7, 8, 10]) {
    schedules.push({
      name: `grow_${startExp}_to_${endExp}`,
      schedule: [
        { SHUFFLE_SEED: 0, ...base, EXPANSION_DEGREES: startExp },
        {
          SHUFFLE_SEED: 1,
          ...base,
          EXPANSION_DEGREES: Math.ceil((startExp + endExp) / 2),
        },
        { SHUFFLE_SEED: 2, ...base, EXPANSION_DEGREES: endExp },
      ],
    });
  }
}

// 4. More seeds with high expansion
for (const numSeeds of [3, 4, 5, 6]) {
  for (const exp of [6, 7, 8]) {
    const schedule: ScheduleEntry[] = [];
    for (let i = 0; i < numSeeds; i++) {
      schedule.push({
        SHUFFLE_SEED: i,
        ...base,
        EXPANSION_DEGREES: exp + Math.floor(i / 2),
      });
    }
    schedules.push({ name: `seeds${numSeeds}_exp${exp}`, schedule });
  }
}

// 5. High expansion with different GM
for (const gm of [2.5, 3, 3.5, 4, 5]) {
  schedules.push({
    name: `exp6_gm${gm}`,
    schedule: [
      {
        SHUFFLE_SEED: 0,
        CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
        EXPANSION_DEGREES: 6,
        GREEDY_MULTIPLIER: gm,
      },
      {
        SHUFFLE_SEED: 1,
        CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
        EXPANSION_DEGREES: 6,
        GREEDY_MULTIPLIER: gm,
      },
      {
        SHUFFLE_SEED: 2,
        CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
        EXPANSION_DEGREES: 7,
        GREEDY_MULTIPLIER: gm,
      },
    ],
  });
}

// 6. High expansion with different COF
for (const cof of [0, 0.5, 1, 1.5, 2]) {
  schedules.push({
    name: `exp6_cof${cof}`,
    schedule: [
      {
        SHUFFLE_SEED: 0,
        CENTER_OFFSET_DIST_PENALTY_FACTOR: cof,
        EXPANSION_DEGREES: 6,
        GREEDY_MULTIPLIER: 3,
      },
      {
        SHUFFLE_SEED: 1,
        CENTER_OFFSET_DIST_PENALTY_FACTOR: cof,
        EXPANSION_DEGREES: 6,
        GREEDY_MULTIPLIER: 3,
      },
      {
        SHUFFLE_SEED: 2,
        CENTER_OFFSET_DIST_PENALTY_FACTOR: cof,
        EXPANSION_DEGREES: 7,
        GREEDY_MULTIPLIER: 3,
      },
    ],
  });
}

// 7. High expansion with NODE_PF_FACTOR
for (const npf of [20, 30, 50, 70, 100]) {
  schedules.push({
    name: `exp6_npf${npf}`,
    schedule: [
      { SHUFFLE_SEED: 0, ...base, EXPANSION_DEGREES: 6, NODE_PF_FACTOR: npf },
      { SHUFFLE_SEED: 1, ...base, EXPANSION_DEGREES: 6, NODE_PF_FACTOR: npf },
      { SHUFFLE_SEED: 2, ...base, EXPANSION_DEGREES: 7, NODE_PF_FACTOR: npf },
    ],
  });
}

// 8. Combined best params with exp 6
for (const npf of [30, 50]) {
  for (const gm of [3, 3.5]) {
    schedules.push({
      name: `exp6_npf${npf}_gm${gm}`,
      schedule: [
        {
          SHUFFLE_SEED: 0,
          CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
          EXPANSION_DEGREES: 6,
          GREEDY_MULTIPLIER: gm,
          NODE_PF_FACTOR: npf,
        },
        {
          SHUFFLE_SEED: 1,
          CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
          EXPANSION_DEGREES: 6,
          GREEDY_MULTIPLIER: gm,
          NODE_PF_FACTOR: npf,
        },
        {
          SHUFFLE_SEED: 2,
          CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
          EXPANSION_DEGREES: 7,
          GREEDY_MULTIPLIER: gm,
          NODE_PF_FACTOR: npf,
        },
      ],
    });
  }
}

// Run tests
console.log("Fine-tuning around EXPANSION_DEGREES=6");
console.log("Best so far: -59.55 with exp 6,6,7");
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

let bestScore = -59.55;

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

// Restore
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
