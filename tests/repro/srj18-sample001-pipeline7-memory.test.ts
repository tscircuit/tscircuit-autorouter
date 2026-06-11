import { afterAll, expect, test } from "bun:test"
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs"
import os from "node:os"
import path from "node:path"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import {
  PipelineMemoryAnalysisRunner,
  type PipelineMemoryAnalysisResult,
} from "lib/testing/PipelineMemoryAnalysisRunner"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

const tempDirs: string[] = []

afterAll(() => {
  for (const tempDir of tempDirs) {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

const readJson = <T>(filePath: string) =>
  JSON.parse(readFileSync(filePath, "utf8")) as T

test(
  "srj18 sample001 pipeline7 memory analysis writes compact stage metadata",
  async () => {
    const sample = await loadScenarioBySampleNumber("srj18", 1)
    const outputDir = mkdtempSync(
      path.join(os.tmpdir(), "pipeline7-memory-srj18-sample001-"),
    )
    tempDirs.push(outputDir)

    const solver = new AutoroutingPipelineSolver7_MultiGraph(
      structuredClone(sample.scenario),
      {
        cacheProvider: null,
      },
    )
    const expectedStageNames = [
      "preprocessSimpleRouteJsonSolver",
      "componentDetectionSolver",
      "componentTopologyGeneratorSolver",
      "escapeViaLocationSolver",
    ]

    solver.pipelineDef = solver.pipelineDef.slice(0, expectedStageNames.length)

    const runner = new PipelineMemoryAnalysisRunner({
      pipelineSolver: solver,
      outputDir,
      runLabel: "srj18-sample001-bounded",
      captureHeapSnapshots: false,
    })

    const result = await runner.run()
    const manifest = readJson<{
      runLabel: string
      solved: boolean
      failed: boolean
      error: string | null
      captures: PipelineMemoryAnalysisResult["captures"]
    }>(path.join(outputDir, "manifest.json"))

    expect(result.solved).toBe(true)
    expect(result.failed).toBe(false)
    expect(result.error).toBeNull()
    expect(result.captures.map((capture) => capture.stageName)).toEqual(
      expectedStageNames,
    )
    expect(result.captures.every((capture) => capture.heapSnapshotPath === null)).toBe(
      true,
    )

    expect(manifest.runLabel).toBe("srj18-sample001-bounded")
    expect(manifest.solved).toBe(true)
    expect(manifest.failed).toBe(false)
    expect(manifest.error).toBeNull()
    expect(manifest.captures.map((capture) => capture.stageName)).toEqual(
      expectedStageNames,
    )

    const preprocessInput = readJson<{
      type: string
      length: number
      items: unknown[]
    }>(result.captures[0].inputSummaryPath)
    const componentDetectionOutput = readJson<{
      type: string
      length: number
      items: unknown[]
    }>(result.captures[1].outputSummaryPath)
    const escapeViaMemory = readJson<{
      solverName: string
      solverIterations: number
      elapsedMs: number | null
      deltaFromAfterGcToAfterSnapshotGc: Record<string, number>
    }>(result.captures[3].memoryPath)
    const escapeViaHandoff = readFileSync(result.captures[3].handoffPath, "utf8")

    expect(preprocessInput.type).toBe("array")
    expect(preprocessInput.length).toBe(1)
    expect(preprocessInput.items.length).toBe(1)

    expect(componentDetectionOutput.type).toBe("array")
    expect(componentDetectionOutput.length).toBeGreaterThan(0)
    expect(componentDetectionOutput.items.length).toBeLessThanOrEqual(8)

    expect(escapeViaMemory.solverName).toBe("EscapeViaLocationSolver")
    expect(escapeViaMemory.solverIterations).toBeGreaterThan(0)
    expect(typeof escapeViaMemory.deltaFromAfterGcToAfterSnapshotGc.heapUsed).toBe(
      "number",
    )
    expect(escapeViaMemory.elapsedMs).not.toBeNull()

    expect(escapeViaHandoff).toContain("# Handoff: stage 4 `escapeViaLocationSolver`")
    expect(escapeViaHandoff).toContain("Latest findings:")
    expect(escapeViaHandoff).toContain("Memory metrics:")

    expect(readdirSync(outputDir)).toContain("manifest.json")
    expect(
      readdirSync(outputDir).some((name) => name.endsWith(".heapsnapshot")),
    ).toBe(false)
  },
  { timeout: 120_000 },
)
