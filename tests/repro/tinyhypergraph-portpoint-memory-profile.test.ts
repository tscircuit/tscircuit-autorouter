import { expect, test } from "bun:test"
import input from "../../fixtures/features/portpointpathing/tinyhypergraph-port-bridge-repro-input.json"
import { runTinyHypergraphPortPointProfile } from "../../scripts/analyze-portpoint-tiny-memory"

test(
  "tiny-hypergraph port point memory profile captures constructor and stage checkpoints",
  async () => {
    const result = await runTinyHypergraphPortPointProfile({
      params: input as any,
      runLabel: "fixture-001",
    })

    expect(result.solved).toBe(true)
    expect(result.failed).toBe(false)
    expect(result.error).toBeNull()

    const labels = result.checkpoints.map((checkpoint) => checkpoint.label)

    expect(labels).toContain("solver:constructor:start")
    expect(labels).toContain(
      "solver:constructor:after-buildSerializedTinyGraph",
    )
    expect(labels.some((label) => label.startsWith("solver:stage:"))).toBe(true)
    expect(labels).toContain("solver:after-solve")
    expect(labels).toContain("solver:after-getOutput")

    const duplicateCheckpoint = result.checkpoints.find((checkpoint) =>
      checkpoint.label.includes("duplicateCongestedPortPrepass"),
    )
    expect(duplicateCheckpoint).toBeDefined()
    expect(typeof duplicateCheckpoint?.memoryAfterGc.heapUsed).toBe("number")

    expect(result.outputSummary.nodeCount).toBeGreaterThan(0)
    expect(result.outputSummary.inputPortPointCount).toBeGreaterThan(0)
  },
  { timeout: 30_000 },
)
