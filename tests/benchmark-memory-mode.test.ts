import { expect, test } from "bun:test"
import { parseArgs } from "../scripts/benchmark/index"

test("memory measurement is explicit and preserves normal benchmark mode", () => {
  expect(parseArgs([]).measureMemory).toBeFalse()
  expect(parseArgs(["--measure-memory"]).measureMemory).toBeTrue()
})
