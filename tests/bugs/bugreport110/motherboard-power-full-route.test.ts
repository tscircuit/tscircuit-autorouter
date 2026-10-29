import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { writeFileSync } from "node:fs"
import { gzipSync } from "node:zlib"
import { PowerTraceExpanderSolver as OriginalPowerTraceExpanderSolver } from "@tscircuit/power-trace-expander-baseline"
import { solveForComparison } from "../../../fixtures/bug-reports/bugreport110-motherboard-power-phase/solve-for-comparison"

test("preserves the complete motherboard output against the original expander on the same runtime", (): void => {
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
  const originalOutput: string = JSON.stringify({
    ...current.output,
    traces: [...current.expansionInput.fixedTraces, ...original.getOutput()],
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
  // Exact full-output equality on this runtime, including every width, via,
  // coordinate and replacement ID. No geometry rounding or accepted-hash list.
  expect(currentHash).toBe(originalHash)
})
