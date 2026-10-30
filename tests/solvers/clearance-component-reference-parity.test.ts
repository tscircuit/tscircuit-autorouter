import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { RelaxTraceClearanceSolver, type RelaxTraceClearanceInput } from "@tscircuit/repair04"
import { createPipeline9TestRuntime } from "../fixtures/createPipeline9TestRuntime"

test("parallel clearance constraints preserve original golden geometry", async (): Promise<void> => {
  const directory = new URL("../../node_modules/@tscircuit/repair04/tests/fixtures/", import.meta.url)
  const golden = JSON.parse(readFileSync(new URL("clearance-projection-revisions.json", directory), "utf8"))
  const runtime = createPipeline9TestRuntime(4)
  try {
    for (const [name, value] of Object.entries(golden)) {
      const expected = value as { sha256: string }
      const input: RelaxTraceClearanceInput = JSON.parse(readFileSync(new URL(`clearance-repros/${name}`, directory), "utf8")).input
      const before = JSON.stringify(input)
      for (const parallel of [false, true]) {
        const solver = new RelaxTraceClearanceSolver(input)
        if (parallel) await solver.solveAsync(runtime)
        else solver.solve()
        expect(solver.solved).toBe(true)
        expect(createHash("sha256").update(JSON.stringify(solver.getOutput())).digest("hex"), `${name}, parallel=${parallel}`).toBe(expected.sha256)
        expect(JSON.stringify(input)).toBe(before)
      }
    }
  } finally {
    await runtime.dispose()
  }
})
