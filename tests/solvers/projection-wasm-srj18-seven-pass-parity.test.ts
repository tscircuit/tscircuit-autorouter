import { initializeReferenceDrcRuntime } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/initializeReferenceDrcRuntime"
import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import type { RelaxTraceClearanceInput } from "@tscircuit/repair04"
import type { HighDensityRoute } from "high-density-repair03/lib"
import type { RepairJunctionAnchors } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/repair04/getRepairJunctionAnchors"
import stableStringify from "fast-json-stable-stringify"
import { Pipeline9IndexedRelaxTraceClearanceSolver } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/repair04/Pipeline9IndexedRelaxTraceClearanceSolver"
import { Pipeline9WasmRelaxTraceClearanceSolver } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/repair04/Pipeline9WasmRelaxTraceClearanceSolver"

type Vertex = { x: number; y: number; revision: number }
type ProjectionState = {
  phase: string
  vertices: Map<string, Vertex>
  sweepIndex: number
  sweepPairIndex: number
  sweepPadIndex: number
}
type Fixture = {
  snapshot: string
  sample: number
  rows: {
    number: number
    input: RelaxTraceClearanceInput
    expected: {
      outputHash: string
      iterations: number
      maximumIterations: number
      stats: Record<string, unknown>
    }
  }[]
}

class NativeAnchorCapture extends Pipeline9IndexedRelaxTraceClearanceSolver {
  preparedAnchors: RepairJunctionAnchors[] = []

  protected override createJunctionAnchors(
    srj: RelaxTraceClearanceInput["srj"],
    routes: HighDensityRoute[],
    bounds: RelaxTraceClearanceInput["bounds"],
  ): RepairJunctionAnchors[] {
    this.preparedAnchors = super.createJunctionAnchors(srj, routes, bounds)
    return this.preparedAnchors
  }
}

class OptimizedAnchorCapture extends Pipeline9WasmRelaxTraceClearanceSolver {
  preparedAnchors: RepairJunctionAnchors[] = []

  protected override createJunctionAnchors(
    srj: RelaxTraceClearanceInput["srj"],
    routes: HighDensityRoute[],
    bounds: RelaxTraceClearanceInput["bounds"],
  ): RepairJunctionAnchors[] {
    this.preparedAnchors = super.createJunctionAnchors(srj, routes, bounds)
    return this.preparedAnchors
  }
}

test("WASM preserves every native batch in all seven actual SRJ18 sample015 projection passes", async (): Promise<void> => {
  await initializeReferenceDrcRuntime()
  const fixture: Fixture = JSON.parse(gunzipSync(new Uint8Array(readFileSync(
    new URL("../fixtures/projection-wasm-srj18/sample015-native-seven-passes.json.gz", import.meta.url),
  ))).toString())
  expect(fixture.rows).toHaveLength(7)
  let comparedVertexRecords = 0
  let completedBatches = 0
  for (const { number, input, expected } of fixture.rows) {
    const immutableInput = structuredClone(input)
    const native = new NativeAnchorCapture(input)
    const optimized = new OptimizedAnchorCapture(input)
    const nativeState = native as unknown as ProjectionState
    const optimizedState = optimized as unknown as ProjectionState
    while (!native.solved && !native.failed) {
      const wasSweep = nativeState.phase === "sweeps"
      native.step()
      optimized.step()
      expect({
        stats: optimized.stats, iterations: optimized.iterations,
        progress: optimized.progress, cap: optimized.MAX_ITERATIONS,
        solved: optimized.solved, failed: optimized.failed, error: optimized.error,
        phase: optimizedState.phase, sweep: optimizedState.sweepIndex,
        pairCursor: optimizedState.sweepPairIndex, padCursor: optimizedState.sweepPadIndex,
      }).toEqual({
        stats: native.stats, iterations: native.iterations,
        progress: native.progress, cap: native.MAX_ITERATIONS,
        solved: native.solved, failed: native.failed, error: native.error,
        phase: nativeState.phase, sweep: nativeState.sweepIndex,
        pairCursor: nativeState.sweepPairIndex, padCursor: nativeState.sweepPadIndex,
      })
      if (wasSweep) {
        const nativeVertices = [...nativeState.vertices.values()]
        const optimizedVertices = [...optimizedState.vertices.values()]
        expect(optimizedVertices.length).toBe(nativeVertices.length)
        for (let index = 0; index < nativeVertices.length; index++) {
          const a = nativeVertices[index]!
          const b = optimizedVertices[index]!
          if (!Object.is(a.x, b.x) || !Object.is(a.y, b.y) || a.revision !== b.revision)
            throw new Error(`Projection ${number} batch ${completedBatches} vertex ${index} differs`)
          comparedVertexRecords++
        }
        completedBatches++
      }
    }
    expect(optimized.preparedAnchors).toEqual(native.preparedAnchors)
    expect(optimized.preparedAnchors).toHaveLength(input.routes.length)
    expect(optimized.junctionPreparationDiagnostics).toEqual({
      usedEndpointComponentProof: true, canonicalNetCount: 103,
    })
    expect(native.solved && optimized.solved && !optimized.failed).toBe(true)
    expect(optimized.getOutput()).toEqual(native.getOutput())
    expect(optimized.iterations).toBe(expected.iterations)
    expect(optimized.MAX_ITERATIONS).toBe(expected.maximumIterations)
    expect(optimized.stats).toEqual(expected.stats)
    expect(createHash("sha256").update(stableStringify(optimized.getOutput())).digest("hex"))
      .toBe(expected.outputHash)
    expect(optimized.kernelDiagnostics.enabled).toBe(true)
    expect(optimized.kernelDiagnostics.guardCalls).toBeGreaterThan(0)
    expect(input).toEqual(immutableInput)
  }
  expect(completedBatches).toBe(20224)
  expect(comparedVertexRecords).toBe(98258176)
})
