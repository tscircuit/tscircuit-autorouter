import { expect, test } from "bun:test"
import { parseArgs } from "../scripts/benchmark/index"

test("benchmark memory limits require positive MiB values and remain opt-in", (): void => {
  expect(parseArgs([]).sampleMaxRssBytes).toBeUndefined()
  expect(parseArgs(["--max-rss-mib", "12288"]).sampleMaxRssBytes).toBe(
    12 * 1024 ** 3,
  )
  for (const value of ["", "0", "-1", "NaN", "Infinity"]) {
    expect(() => parseArgs(["--max-rss-mib", value])).toThrow(
      "--max-rss-mib must be a positive number",
    )
  }
})
