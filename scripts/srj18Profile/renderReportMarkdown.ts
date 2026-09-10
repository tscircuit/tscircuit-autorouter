import { writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import type {
  ClassTiming,
  NodeSummary,
  SampleSummary,
  StageSummary,
} from "./reportTypes"

type SolverName = string
type Summary = {
  totalMedianMs: number
  averageMs: number
  p50Ms: number
  p95Ms: number
  baselineRuns: number
  samples: SampleSummary[]
  stages: StageSummary[]
  nodes: NodeSummary[]
  classes: ClassTiming[]
}

function markdownTable(
  columns: string[],
  rows: (string | number | null)[][],
): string {
  const header = `| ${columns.join(" | ")} |`
  const separator = `| ${columns.map(() => "---").join(" | ")} |`
  const body = rows.map(
    (row) =>
      `| ${row
        .map((field) =>
          String(field ?? "—")
            .replaceAll("|", "\\|")
            .replaceAll("\n", " "),
        )
        .join(" | ")} |`,
  )
  return [header, separator, ...body].join("\n")
}

function formatDurationSeconds(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    throw new Error("Duration must be finite and nonnegative")
  }
  const durationSeconds = durationMs / 1000
  return durationSeconds.toFixed(3)
}

export async function renderReportMarkdown(outDir: string): Promise<void> {
  const summary = (await Bun.file(
    resolve(outDir, "summary.json"),
  ).json()) as Summary
  const solved = summary.samples.filter((sample) => sample.solved)
  const solverTotals = new Map<
    SolverName,
    {
      solver: string
      selfMs: number
      constructionSelfMs: number
      constructions: number
      stepCalls: number
    }
  >()
  for (const timing of summary.classes) {
    let total = solverTotals.get(timing.solver)
    if (!total) {
      total = {
        solver: timing.solver,
        selfMs: 0,
        constructionSelfMs: 0,
        constructions: 0,
        stepCalls: 0,
      }
      solverTotals.set(timing.solver, total)
    }
    total.selfMs += timing.selfMs
    total.constructionSelfMs += timing.constructionSelfMs
    total.constructions += timing.constructions
    total.stepCalls += timing.stepCalls
  }
  const solvers = [...solverTotals.values()].sort(
    (left, right) => right.selfMs - left.selfMs,
  )
  const markdown =
    [
      "# SRJ18 / Pipeline9 measured results",
      `Fresh baseline: ${summary.samples.length} samples, ${summary.baselineRuns} runs. ${solved.length}/${summary.samples.length} samples solved in every observed baseline run. ${solved.filter((sample) => sample.drcErrors === 0).length} successful samples have zero relaxed DRC errors.`,
      `Sum of per-sample median time to termination: **${formatDurationSeconds(summary.totalMedianMs)} s**. Average: ${formatDurationSeconds(summary.averageMs)} s. P50: ${formatDurationSeconds(summary.p50Ms)} s. P95 (nearest rank): ${formatDurationSeconds(summary.p95Ms)} s. These statistics include time to failure.`,
      "## Every sample",
      markdownTable(
        [
          "Sample",
          "Median s",
          "Min s",
          "Max s",
          "Solved",
          "DRC errors",
          "Output parity",
          "Outcome parity",
          "Profiler ×",
        ],
        summary.samples.map((sample) => [
          sample.sampleId,
          formatDurationSeconds(sample.medianMs),
          formatDurationSeconds(sample.minMs),
          formatDurationSeconds(sample.maxMs),
          String(sample.solved),
          sample.drcErrors,
          sample.outputParity === null
            ? "not applicable / not measured"
            : String(sample.outputParity),
          sample.outcomeParity === null
            ? "not measured"
            : String(sample.outcomeParity),
          sample.overheadRatio?.toFixed(3) ?? null,
        ]),
      ),
      "Output parity compares baseline and detailed output hashes on successful samples. Outcome parity compares solved/failed flags, error text and iteration count; a matching failure does not certify partial routing geometry.",
      "## Every pipeline stage",
      markdownTable(
        ["Stage", "Total median s", "Share %", "Slowest sample", "Its stage s"],
        summary.stages.map((stage) => [
          stage.stage,
          formatDurationSeconds(stage.durationMs),
          stage.sharePercent.toFixed(2),
          stage.maxSample,
          formatDurationSeconds(stage.maxSampleMs),
        ]),
      ),
      "Stage totals sum the per-sample medians. They include input preparation, construction, the solver steps and completion callbacks. Their sum may differ from the median total because of driver overhead and independent medians. Detailed per-board stages are in [sampleStages.csv](sampleStages.csv).",
      "## Slowest high-density nodes",
      markdownTable(
        [
          "Sample",
          "Node",
          "Median s",
          "Winner",
          "Ports",
          "Connections",
          "Width mm",
          "Height mm",
          "Growths",
        ],
        summary.nodes
          .slice(0, 40)
          .map((node) => [
            node.sampleId,
            node.nodeId,
            formatDurationSeconds(node.medianMs),
            node.winningSolver,
            node.ports,
            node.connections,
            node.width.toFixed(3),
            node.height.toFixed(3),
            node.resizeCount,
          ]),
      ),
      `All ${summary.nodes.length} nodes are in [nodes.csv](nodes.csv). The [interactive report](report.html) can filter and drill into each node's nested solvers.`,
      "## Largest nested solver costs",
      markdownTable(
        [
          "Solver",
          "Detailed self s",
          "Constructor self s",
          "Constructions",
          "step calls",
        ],
        solvers
          .slice(0, 30)
          .map((solver) => [
            solver.solver,
            formatDurationSeconds(solver.selfMs),
            formatDurationSeconds(solver.constructionSelfMs),
            solver.constructions,
            solver.stepCalls,
          ]),
      ),
      "These are instrumented self times, not production wall times. Nested measured calls are subtracted. Lifecycle records and constructor records can describe the same solver object when its constructor invokes a measured method; construction counts and record counts have different meanings. State flags are last observed snapshots, so a zero-step or nonterminal record alone does not prove a failure.",
      "## Failures",
      ...summary.samples
        .filter((sample) => !sample.solved)
        .map((sample) => `- **${sample.sampleId}**: ${sample.error}`),
      "## Raw evidence",
      "[Sample summaries](samples.csv), [stage summaries](stages.csv), [stages by sample](sampleStages.csv), [all nodes](nodes.csv), [solver summaries](classes.csv), [node × solver summaries](nodeSolvers.csv), [machine-readable summary](summary.json). The detailed, solver-records and cpu folders contain the full instrumented and native profiles. See the repository profiling guide for timer boundaries and limitations.",
    ].join("\n\n") + "\n"
  await writeFile(resolve(outDir, "summary.md"), markdown)
}
