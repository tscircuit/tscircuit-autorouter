import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { writeFileSync } from "node:fs"
import { gzipSync } from "node:zlib"
import { PowerTraceExpanderSolver as OriginalPowerTraceExpanderSolver } from "@tscircuit/power-trace-expander-baseline"
import { measureTraceWidths } from "@tscircuit/power-trace-expander"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimplifiedPcbTrace } from "lib/types"
import { loadMotherboardPowerPhase } from "../../../fixtures/bug-reports/bugreport110-motherboard-power-phase/repro"
import { solveForComparison } from "../../../fixtures/bug-reports/bugreport110-motherboard-power-phase/solve-for-comparison"

test("retains completed motherboard widening without regressing fixed copper or DRC", (): void => {
  const current = solveForComparison()
  // Completed search trees are not needed for the baseline replay.
  Bun.gc(true)
  const original = new OriginalPowerTraceExpanderSolver(
    current.expansionInput,
    current.expansionOptions,
  )
  original.solve()
  expect(original.failed).toBe(false)
  expect(original.solved).toBe(true)
  if (!current.expansionInput.fixedTraces) {
    throw new Error("Motherboard expansion input is missing fixed copper")
  }
  const originalTraces = original.getOutput() as SimplifiedPcbTrace[]
  const originalOutput: string = JSON.stringify({
    ...current.output,
    traces: [...current.expansionInput.fixedTraces, ...originalTraces],
  })
  const currentOutput: string = JSON.stringify(current.output)
  const originalHash: string = createHash("sha256")
    .update(originalOutput)
    .digest("hex")
  const currentHash: string = createHash("sha256")
    .update(currentOutput)
    .digest("hex")
  console.log(JSON.stringify({ originalHash, currentHash }))
  if (currentHash !== originalHash) {
    for (const [name, output] of [
      ["original", originalOutput],
      ["fixed", currentOutput],
    ] as const) {
      writeFileSync(
        new URL(
          `../../../fixtures/bug-reports/bugreport110-motherboard-power-phase/${name}.received.json.gz`,
          import.meta.url,
        ),
        new Uint8Array(gzipSync(output)),
      )
    }
  }
  const fixedTraces = current.expansionInput.fixedTraces as SimplifiedPcbTrace[]
  const currentTraces = current.output.traces!
  expect(currentTraces.slice(0, fixedTraces.length)).toEqual(fixedTraces)
  const expandedTraces = currentTraces.slice(fixedTraces.length)
  const beforeWidths = measureTraceWidths(
    current.expansionInput,
    original.getOutput(),
  )
  const afterWidths = measureTraceWidths(current.expansionInput, expandedTraces)
  let improvedWidths = 0
  for (const [width, before] of beforeWidths) {
    const after = afterWidths.get(width)!
    expect(after).toBeDefined()
    expect(after.traceCount).toBe(before.traceCount)
    expect(after.normalizedWidthDeficit).toBeLessThanOrEqual(
      before.normalizedWidthDeficit + 1e-9,
    )
    if (after.normalizedWidthDeficit < before.normalizedWidthDeficit - 1e-9) {
      improvedWidths++
    }
  }
  expect(improvedWidths).toBeGreaterThan(0)
  const countErrors = (traces: SimplifiedPcbTrace[]): Map<string, number> => {
    const counts = new Map<string, number>()
    const { errors } = evaluateRelaxedDrc({
      inputSrj: loadMotherboardPowerPhase(),
      srjWithPointPairs: current.srjWithPointPairs,
      routedTraces: traces,
    })
    for (const error of errors) {
      counts.set(error.type, (counts.get(error.type) ?? 0) + 1)
    }
    return counts
  }
  const beforeErrors = countErrors([...fixedTraces, ...originalTraces])
  const afterErrors = countErrors(currentTraces)
  for (const [type, count] of afterErrors) {
    expect(count).toBeLessThanOrEqual(beforeErrors.get(type) ?? 0)
  }
})
