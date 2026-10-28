import { test, expect } from "bun:test"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createPhaseCheckpointObserver } from "../../scripts/experiment-audit/phase-checkpoint-observer"
import { createStageGeometryCapture } from "../../scripts/experiment-audit/stage-geometry-capture"

test("completed snapshots retain pre-mutation geometry without adding factory or solver work", () => {
  const directory = mkdtempSync(join(tmpdir(), "stage-boundary-immutable-"))
  const capture = createStageGeometryCapture({ outputDirectory: directory, metadata: { inputSha256: "original" }, sourceSha256: "c".repeat(64), original: { connections: [] } })
  const route = { connectionName: "owner", route: [{ x: 1, y: 2, z: 0 }], vias: [] }
  let factoryCalls = 0
  const stage = { solved: false, failed: false, iterations: 0, MAX_ITERATIONS: 2, routes: [route], nodePfById: new Map([["node", 0.1]]) }
  const pipeline: any = { currentPipelineStepIndex: 0, activeSubSolver: null, solved: false, failed: false, iterations: 0, MAX_ITERATIONS: 4,
    pipelineDef: [{ solverName: "highDensityRouteSolver", getConstructorParams() { factoryCalls++; return [{ routes: [route], nodePfById: stage.nodePfById }] } }],
    _step() {
      if (!this.activeSubSolver) { this.pipelineDef[0].getConstructorParams(this); this.activeSubSolver = stage; return }
      stage.iterations++; stage.solved = true; this.activeSubSolver = null; this.currentPipelineStepIndex++
    } }
  const observer = createPhaseCheckpointObserver({ outputDirectory: directory, metadata: {}, sourceSha256: "o".repeat(64), diagnosticBoundary: capture.captureBoundary })
  observer.install(pipeline); pipeline._step(); pipeline._step()
  route.route[0].x = 900; stage.nodePfById.set("node", 4)
  const status: any = capture.getStatus()
  expect(factoryCalls).toBe(1); expect(stage.iterations).toBe(1); expect(status.errors).toEqual([])
  const completed = status.records.find((row: any) => row.boundary === "completed_phase")
  const saved = JSON.parse(readFileSync(join(directory, "stage-geometry", completed.file), "utf8"))
  expect(saved.value.routes[0].route[0].x).toBe(1)
  expect(saved.value.nodePfById).toEqual({ $map: [["node", 0.1]] })
  expect(status.records.filter((row: any) => row.boundary === "constructor_params_return")).toHaveLength(1)
  expect(status.records.filter((row: any) => row.boundary === "completed_phase")).toHaveLength(1)
})
