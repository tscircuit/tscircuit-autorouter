import { afterAll, expect, test } from "bun:test"
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs"
import os from "node:os"
import path from "node:path"
import { AutoroutingPipelineSolver4 } from "lib"
import { PipelineStageDebugRunner } from "lib/testing/PipelineStageDebugRunner"
import type { SimpleRouteJson } from "lib/types"
import { loadScenarioBySampleNumber } from "../scripts/benchmark/scenarios"

const tempDirs: string[] = []

afterAll(() => {
  for (const tempDir of tempDirs) {
    rmSync(tempDir, { recursive: true, force: true })
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
