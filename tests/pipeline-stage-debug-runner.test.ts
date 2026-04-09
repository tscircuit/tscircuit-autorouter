import { afterAll, expect, test } from "bun:test"
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import os from "node:os"
import path from "node:path"
import { AutoroutingPipelineSolver4 } from "lib"
import { PipelineStageDebugRunner } from "lib/testing/PipelineStageDebugRunner"
import type { SimpleRouteJson } from "lib/types"
import { loadScenarioBySampleNumber } from "../scripts/benchmark/scenarios"

const tempDirs: string[] = []
const repoTempPaths: string[] = []

afterAll(() => {
  for (const tempDir of tempDirs) {
    rmSync(tempDir, { recursive: true, force: true })
  }
  for (const repoTempPath of repoTempPaths) {
    rmSync(repoTempPath, { recursive: true, force: true })
  }
})

const srj: SimpleRouteJson = {
  layerCount: 2,
  minTraceWidth: 0.15,
  minViaDiameter: 0.3,
  obstacles: [],
  connections: [
    {
      name: "conn1",
      pointsToConnect: [
        { x: -0.5, y: 0, layer: "top" },
        { x: 0.5, y: 0, layer: "top" },
      ],
    },
  ],
  bounds: {
    minX: -5,
    maxX: 5,
    minY: -5,
    maxY: 5,
  },
}

test("loadScenarioBySampleNumber follows benchmark dataset ordering", async () => {
  const sample = await loadScenarioBySampleNumber("dataset01", 1)

  expect(sample.sampleNumber).toBe(1)
  expect(sample.scenarioName).toBe("circuit001")
  expect(sample.totalSamples).toBeGreaterThan(1)
  expect(sample.scenario.bounds).toBeDefined()
})

test(
  "PipelineStageDebugRunner writes per-stage PNGs and logs for pipeline4",
  async () => {
    const outputDir = mkdtempSync(
      path.join(os.tmpdir(), "pipeline-stage-debug-runner-"),
    )
    tempDirs.push(outputDir)

    const runner = new PipelineStageDebugRunner({
      pipelineSolver: new AutoroutingPipelineSolver4(srj),
      outputDir,
      pngWidth: 1024,
      pngHeight: 1024,
      context: {
        scenarioName: "test-srj",
      },
    })

    const result = await runner.run()
    const outputFiles = readdirSync(outputDir).sort()
    const logs = readFileSync(path.join(outputDir, "logs.txt"), "utf8")

    expect(result.solved).toBe(true)
    expect(result.failed).toBe(false)
    expect(result.stageArtifacts.length).toBe(
      runner.pipelineSolver.pipelineDef.length,
    )
    expect(outputFiles).toContain("logs.txt")
    expect(outputFiles).toContain("stage01-netToPointPairsSolver.png")
    expect(outputFiles).toContain("stage10-highDensityRepairSolver.png")
    expect(outputFiles).toContain("stage13-traceWidthSolver.png")
    expect(logs).toContain("enter stage=1 name=netToPointPairsSolver")
    expect(logs).toContain("captured stage=10 name=highDensityRepairSolver")
    expect(
      statSync(path.join(outputDir, "stage13-traceWidthSolver.png")).size,
    ).toBeGreaterThan(0)
  },
  { timeout: 120_000 },
)

test(
  "run-sample emits relative paths and appends DRC summary to logs",
  () => {
    const inputDir = path.join(
      process.cwd(),
      "tmp",
      `run-sample-test-${Date.now()}`,
    )
    const srjPath = path.join(inputDir, "input.json")
    const outputDir = path.join(inputDir, "output")
    repoTempPaths.push(inputDir)

    mkdirSync(inputDir, { recursive: true })
    writeFileSync(srjPath, JSON.stringify(srj))

    const proc = Bun.spawnSync({
      cmd: [
        "bun",
        "run",
        "scripts/run-sample.ts",
        "--srj-path",
        srjPath,
        "--out-dir",
        outputDir,
        "--png-size",
        "1024",
      ],
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    })

    const stdout = proc.stdout.toString()
    const stderr = proc.stderr.toString()
    const logs = readFileSync(path.join(outputDir, "logs.txt"), "utf8")

    expect(proc.exitCode).toBe(0)
    expect(stderr).toBe("")
    expect(stdout).toContain("startedAt=")
    expect(stdout).toContain("enter stage=1 name=netToPointPairsSolver")
    expect(stdout).toContain("captured stage=13 name=traceWidthSolver")
    expect(stdout).toContain("postrun")
    expect(stdout).toContain("drc.relaxedPassed=true")
    expect(stdout).toContain("drc.errorCount=0")
    expect(stdout).toContain("Success: yes")
    expect(stdout).toContain("Relaxed DRC: pass")
    expect(stdout).toContain("DRC errors: 0")
    expect(stdout).toContain(
      `Output dir: ./${path.relative(process.cwd(), outputDir)}`,
    )
    expect(stdout).toContain(
      `Logs: ./${path.relative(process.cwd(), path.join(outputDir, "logs.txt"))}`,
    )
    expect(logs).toContain("postrun")
    expect(logs).toContain("drc.relaxedPassed=true")
    expect(logs).toContain("drc.errorCount=0")
    expect(logs).toContain(
      `srjSource=./${path.relative(process.cwd(), srjPath)}`,
    )
  },
  { timeout: 120_000 },
)
