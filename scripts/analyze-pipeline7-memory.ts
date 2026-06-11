#!/usr/bin/env bun

import { appendFile, mkdir, readdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { PipelineMemoryAnalysisRunner } from "lib/testing/PipelineMemoryAnalysisRunner"
import { loadScenarioBySampleNumber } from "./benchmark/scenarios"

const DEFAULT_RUNS = 2
const OUTPUT_ROOT = path.join(
  process.cwd(),
  "ai-artifacts",
  "memory-analysis",
  "pipeline7-srj18-sample001",
)
const PROGRESS_PATH = path.join(process.cwd(), "progress.md")

const parseRuns = () => {
  const argIndex = process.argv.indexOf("--runs")
  if (argIndex === -1) return DEFAULT_RUNS
  const rawValue = process.argv[argIndex + 1]
  const runs = Number.parseInt(rawValue ?? "", 10)
  if (!Number.isFinite(runs) || runs < 1) {
    throw new Error("--runs must be a positive integer")
  }
  return runs
}

const appendProgress = async (lines: string[]) => {
  await appendFile(PROGRESS_PATH, `${lines.join("\n")}\n`)
}

const getExistingRunCount = async () => {
  const entries = await readdir(OUTPUT_ROOT, { withFileTypes: true }).catch(
    () => [],
  )
  return entries.filter(
    (entry) => entry.isDirectory() && /^run-\d{3}$/.test(entry.name),
  ).length
}

const main = async () => {
  const runs = parseRuns()
  const sample = await loadScenarioBySampleNumber("srj18", 1)

  await mkdir(OUTPUT_ROOT, { recursive: true })
  const existingRunCount = await getExistingRunCount()

  await appendProgress([
    `## ${new Date().toISOString()} pipeline7 srj18 sample001 run-start`,
    `- Target: \`srj18\` sample \`001\` (${sample.scenarioName}).`,
    `- Planned runs: ${runs}.`,
    `- Existing runs before start: ${existingRunCount}.`,
    `- Output root: \`./${path.relative(process.cwd(), OUTPUT_ROOT)}\`.`,
    "",
  ])

  const rollup: Array<{
    runLabel: string
    solved: boolean
    failed: boolean
    error: string | null
    stageCount: number
    outputDir: string
  }> = []

  for (let runIndex = 0; runIndex < runs; runIndex++) {
    const runNumber = existingRunCount + runIndex + 1
    const runLabel = `run-${String(runNumber).padStart(3, "0")}`
    const runDir = path.join(OUTPUT_ROOT, runLabel)
    const solver = new AutoroutingPipelineSolver7_MultiGraph(
      structuredClone(sample.scenario),
    )
    const runner = new PipelineMemoryAnalysisRunner({
      pipelineSolver: solver,
      outputDir: runDir,
      runLabel,
      captureHeapSnapshots: true,
    })

    console.log(`[memory-analysis] starting ${runLabel} -> ${runDir}`)
    const result = await runner.run()
    console.log(
      `[memory-analysis] completed ${runLabel} solved=${result.solved} failed=${result.failed} stages=${result.captures.length}`,
    )

    rollup.push({
      runLabel,
      solved: result.solved,
      failed: result.failed,
      error: result.error,
      stageCount: result.captures.length,
      outputDir: runDir,
    })
  }

  await writeFile(path.join(OUTPUT_ROOT, "rollup.json"), `${JSON.stringify(rollup, null, 2)}\n`)

  const latest = rollup[rollup.length - 1]
  await appendProgress([
    `## ${new Date().toISOString()} pipeline7 srj18 sample001 latest-finding`,
    `- Completed ${rollup.length} run(s). Latest run: \`${latest.runLabel}\`.`,
    `- Latest status: solved=${latest.solved} failed=${latest.failed} error=${latest.error ?? "none"}.`,
    `- Latest artifacts: \`./${path.relative(process.cwd(), latest.outputDir)}\`.`,
    `- Rollup: \`./${path.relative(process.cwd(), path.join(OUTPUT_ROOT, "rollup.json"))}\`.`,
    "",
  ])
}

await main()
