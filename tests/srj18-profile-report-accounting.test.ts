import { expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { summarizeResults } from "../scripts/srj18Profile/summarizeResults"
import type { SampleResult, SampleSummary, StageSummary, ClassTiming } from "../scripts/srj18Profile/reportTypes"

test("reports retain failed-stage time, take medians and attribute reused solver calls to their measured stages", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "srj18-profile-test-"))
  try {
    await writeFile(join(outDir, "manifest-all.json"), JSON.stringify({ platform: "linux" }))
    const fixture: SampleResult = {
      schemaVersion: 2, sampleId: "sample001", effort: 1, detailed: false,
      inputSha256: "input", inputConnections: 1, inputObstacles: 1, layerCount: 2,
      solved: false, failed: true, error: "expected iteration limit", durationMs: 0,
      constructionDurationMs: 0, outputDurationMs: 0, validationDurationMs: 0,
      cpuUserMs: 0, cpuSystemMs: 0, peakRssBytes: 1, iterations: 7,
      outputSha256: null, outputTraceCount: null, relaxedDrcErrors: null,
      highDensityStats: null, highDensityNodes: [], nodeTimings: [], profile: null,
      stages: [
        { stage: "first", durationMs: 1, steps: 1, status: "solved", internalDurationMs: 0 },
        { stage: "failed_stage", durationMs: 0, steps: 6, status: "failed", internalDurationMs: 0 },
      ],
    }
    for (const [index, durationMs] of [10, 50, 20].entries()) {
      const directory = join(outDir, `baseline-${index + 1}`)
      await mkdir(directory)
      await writeFile(join(directory, "sample001.json"), JSON.stringify({
        ...fixture, durationMs, stages: [fixture.stages[0], { ...fixture.stages[1], durationMs: durationMs - 1 }],
      }))
    }
    await mkdir(join(outDir, "detailed"))
    const detailed: SampleResult = {
      ...fixture, detailed: true, durationMs: 30,
      profile: {
        solvers: [{ id: 1, parentId: null, solver: "Pipeline", stage: "first", nodeId: null, inclusiveMs: 30, winningSolverId: null }],
        methods: [
          { solverId: 1, owner: "Pipeline", method: "step", stage: "first", calls: 1, selfMs: 2, inclusiveMs: 2, maxCallMs: 2 },
          { solverId: 1, owner: "Pipeline", method: "step", stage: "failed_stage", calls: 6, selfMs: 28, inclusiveMs: 28, maxCallMs: 10 },
        ],
      },
    }
    await writeFile(join(outDir, "detailed", "sample001.json.gz"), Bun.gzipSync(JSON.stringify(detailed)))
    await summarizeResults(outDir)
    const summary = await Bun.file(join(outDir, "summary.json")).json() as { samples: SampleSummary[]; stages: StageSummary[]; classes: ClassTiming[] }
    expect(summary.samples[0].medianMs).toBe(20)
    expect(summary.samples[0].outputParity).toBeNull()
    expect(summary.samples[0].outcomeParity).toBe(true)
    expect(summary.stages[0].stage).toBe("failed_stage")
    expect(summary.stages[0].durationMs).toBe(19)
    expect(summary.stages[0].internalDurationMs).toBe(0)
    expect(summary.classes.find((row) => row.stage === "failed_stage")!.selfMs).toBe(28)
    expect(summary.classes.reduce((sum: number, row: { selfMs: number }) => sum + row.selfMs, 0)).toBe(30)
  } finally {
    await rm(outDir, { recursive: true, force: true })
  }
})
