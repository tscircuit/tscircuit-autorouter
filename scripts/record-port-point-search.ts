#!/usr/bin/env bun
import { plugin } from "bun"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { recorder, json } from "./astar-recording/SearchRecorder"
import { instrumentTinyHypergraph } from "./astar-recording/instrumentTinyHypergraph"
import type { SimpleRouteJson } from "../lib/types"

type Options = {
  pipeline: 7 | 9
  input: string
  output: string
  effort: number
  fullRun: boolean
  record: boolean
  individualEvents: boolean
}

function parseOptions(): Options {
  const args = process.argv.slice(2)
  const options: Options = {
    pipeline: 7,
    input: "fixtures/legacy/assets/e2e3.json",
    output: "",
    effort: 1,
    fullRun: false,
    record: true,
    individualEvents: true,
  }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === "--full-run") options.fullRun = true
    else if (arg === "--events-jsonl-only") options.individualEvents = false
    else if (arg === "--no-record") options.record = false
    else if (
      ["--pipeline", "--srj-path", "--out-dir", "--effort"].includes(arg!)
    ) {
      const value = args[++i]
      if (!value || value.startsWith("--"))
        throw new Error(`Missing value for ${arg}`)
      if (arg === "--pipeline") {
        if (value !== "7" && value !== "9")
          throw new Error("--pipeline must be 7 or 9")
        options.pipeline = Number(value) as 7 | 9
      }
      if (arg === "--srj-path") options.input = value
      if (arg === "--out-dir") options.output = value
      if (arg === "--effort") options.effort = Number(value)
    } else throw new Error(`Unknown argument: ${arg}`)
  }
  if (!options.output) throw new Error("Provide --out-dir with a new directory")
  if (!Number.isFinite(options.effort) || options.effort <= 0)
    throw new Error("--effort must be positive")
  return options
}

const options = parseOptions()
const outputDir = path.resolve(options.output)
mkdirSync(path.dirname(outputDir), { recursive: true })
mkdirSync(outputDir)
const input = JSON.parse(readFileSync(options.input, "utf8")) as SimpleRouteJson
writeFileSync(path.join(outputDir, "input.srj.json"), json(input))
let instrumentedModules = 0
if (options.record) {
  recorder.start(path.join(outputDir, "search"), options.individualEvents)
  plugin({
    name: "record-port-point-astar",
    setup(build): void {
      build.onLoad({ filter: /\/tiny-hypergraph\/lib\/core\.ts$/ }, (args) => {
        instrumentedModules++
        return {
          contents: instrumentTinyHypergraph(
            readFileSync(args.path, "utf8"),
            path.join(import.meta.dir, "astar-recording/SearchRecorder.ts"),
          ),
          loader: "ts",
        }
      })
    },
  })
}

try {
  // Load after registering the plugin, including constructors that solve nested
  // graph searches synchronously before the pipeline exposes its active solver.
  const Solver =
    options.pipeline === 7
      ? (
          await import(
            "../lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
          )
        ).AutoroutingPipelineSolver7_MultiGraph
      : (
          await import(
            "../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
          )
        ).AutoroutingPipelineSolver9_PreloadedTraceGraph
  if (options.record && instrumentedModules !== 1)
    throw new Error(
      `Expected one instrumented A* module, got ${instrumentedModules}`,
    )
  const solver = new Solver(input, {
    effort: options.effort,
    cacheProvider: null,
  })
  let previousStage = ""
  while (!solver.solved && !solver.failed) {
    const stage = solver.getCurrentPhase()
    recorder.stage = stage
    if (stage !== previousStage) {
      console.log(`Stage: ${stage}`)
      previousStage = stage
    }
    solver.step()
    if (!options.fullRun && solver.portPointPathingSolver?.solved) break
  }
  const pathing = solver.portPointPathingSolver
  if (!pathing)
    throw new Error(solver.error ?? "Pipeline never reached port point pathing")
  if (pathing.solved)
    writeFileSync(
      path.join(outputDir, "port-point-output.json"),
      json(pathing.getOutput()),
    )
  if (solver.solved)
    writeFileSync(
      path.join(outputDir, "output.srj.json"),
      json(solver.getOutputSimpleRouteJson()),
    )
  const result = {
    pipeline: options.pipeline,
    effort: options.effort,
    fullRun: options.fullRun,
    solved: solver.solved,
    pathingSolved: pathing.solved,
    failed: solver.failed,
    error: solver.error,
    iterations: solver.iterations,
    instrumentedModules,
  }
  writeFileSync(
    path.join(outputDir, "result.json"),
    JSON.stringify(result, null, 2),
  )
  if (options.record)
    recorder.finish(solver.failed ? "failed" : "complete", result)
  console.log(JSON.stringify(result, null, 2))
  if (solver.failed || !pathing.solved) process.exitCode = 1
} catch (error) {
  if (options.record) recorder.finish("failed", { error: String(error) })
  throw error
}
