import { expect, test } from "bun:test"
import {
  extractPipeline7PortPointPathingParams,
  runTinyHypergraphPortPointProfile,
} from "../../scripts/analyze-portpoint-tiny-memory"

test(
  "tiny-hypergraph duplicate-port constructor prepass stays active without fallback",
  async () => {
    const { params } = await extractPipeline7PortPointPathingParams(1)
    const result = await runTinyHypergraphPortPointProfile({
      params,
      runLabel: "constructor-memory-regression",
    })

    expect(result.solved).toBe(true)
    expect(result.failed).toBe(false)
    expect(result.error).toBeNull()

    const duplicatePrepassCheckpoint = result.checkpoints.find(
      (checkpoint) =>
        checkpoint.label ===
        "solver:constructor:after-duplicateCongestedPortPrepass",
    )
    expect(duplicatePrepassCheckpoint).toBeDefined()
    expect(duplicatePrepassCheckpoint?.stats?.duplicatePrepassFailed).toBe(false)
    expect(
      Number(duplicatePrepassCheckpoint?.stats?.duplicatedPortSourceCount ?? 0),
    ).toBeGreaterThan(0)
    expect(
      Number(duplicatePrepassCheckpoint?.stats?.duplicatedPortCount ?? 0),
    ).toBeGreaterThan(0)

    expect(result.stats.duplicateCongestedPortFallbackToOriginal).toBe(false)
    expect(result.stats.duplicateCongestedPortSourceCount).toBe(
      duplicatePrepassCheckpoint?.stats?.duplicatedPortSourceCount,
    )
    expect(result.stats.duplicateCongestedPortCount).toBe(
      duplicatePrepassCheckpoint?.stats?.duplicatedPortCount,
    )

    const labels = result.checkpoints.map((checkpoint) => checkpoint.label)
    expect(labels.indexOf("solver:constructor:after-duplicateCongestedPortPrepass")).toBeLessThan(
      labels.indexOf("solver:stage:solveGraph"),
    )

    expect(result.checkpoints.at(-1)?.label).toBe("solver:after-getOutput")
  },
  { timeout: 60_000 },
)
