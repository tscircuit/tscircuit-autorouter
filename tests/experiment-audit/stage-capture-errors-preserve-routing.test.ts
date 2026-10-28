import { test, expect } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createPhaseCheckpointObserver } from "../../scripts/experiment-audit/phase-checkpoint-observer"
import { createStageGeometryCapture } from "../../scripts/experiment-audit/stage-geometry-capture"

test("capture rejects accessor geometry and preserves the exact original routing exception", () => {
  const directory = mkdtempSync(join(tmpdir(), "stage-capture-error-"))
  const capture = createStageGeometryCapture({ outputDirectory: directory, metadata: {}, sourceSha256: "c".repeat(64), original: { connections: [] } })
  let getterCalls = 0
  const invalid: any = {}
  Object.defineProperty(invalid, "x", { enumerable: true, get() { getterCalls++; throw new Error("Getter must not execute") } })
  const originalError = new Error("Original solver failure")
  const pipeline: any = { currentPipelineStepIndex: 0, activeSubSolver: null, solved: false, failed: false,
    pipelineDef: [{ solverName: "highDensityRouteSolver", getConstructorParams() { return [{ invalid }] } }],
    _step() { this.pipelineDef[0].getConstructorParams(this); throw originalError } }
  const observer = createPhaseCheckpointObserver({ outputDirectory: directory, metadata: {}, sourceSha256: "o".repeat(64), diagnosticBoundary: capture.captureBoundary })
  observer.install(pipeline)
  let observed: unknown
  try { pipeline._step() } catch (error) { observed = error }
  expect(observed).toBe(originalError); expect(getterCalls).toBe(0)
  expect((capture.getStatus() as any).errors.some((error: string) => error.includes("Accessor in stage data"))).toBe(true)
  expect(pipeline.solved).toBe(false)
})
