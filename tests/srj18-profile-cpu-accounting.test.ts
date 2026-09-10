import { expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { summarizeCpuProfiles } from "../scripts/srj18Profile/summarizeCpuProfiles"

test("native CPU reports separate routing ancestry and deduplicate recursive inclusive samples in compressed profiles", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "srj18-cpu-test-"))
  try {
    const directory = join(outDir, "cpu", "sample001")
    await mkdir(directory, { recursive: true })
    const frame = (
      functionName: string,
      url: string,
    ): {
      functionName: string
      url: string
      lineNumber: number
      columnNumber: number
    } => ({ functionName, url, lineNumber: 0, columnNumber: 0 })
    const profile = {
      nodes: [
        { id: 1, callFrame: frame("root", ""), children: [2, 5] },
        {
          id: 2,
          callFrame: frame("step", "lib/solvers/BaseSolver.ts"),
          children: [3],
        },
        { id: 3, callFrame: frame("search", "lib/search.ts"), children: [4] },
        { id: 4, callFrame: frame("search", "lib/search.ts") },
        { id: 5, callFrame: frame("validation", "lib/check.ts") },
      ],
      samples: [4, 5],
      timeDeltas: [2000, 3000],
      startTime: 0,
      endTime: 5000,
    }
    await writeFile(
      join(directory, "sample.cpuprofile.gz"),
      Bun.gzipSync(JSON.stringify(profile)),
    )
    await summarizeCpuProfiles(outDir)
    const summary = await Bun.file(join(outDir, "cpu-summary.json")).json()
    const search = summary.functions.find(
      (row: { function: string }) => row.function === "search",
    )
    expect(search.selfMs).toBe(2)
    expect(search.inclusiveMs).toBe(2)
    expect(search.routingSelfMs).toBe(2)
    expect(summary.samples[0].sampledMs).toBe(5)
    expect(summary.samples[0].routingSampledMs).toBe(2)
    expect(
      summary.functions.find(
        (row: { function: string }) => row.function === "validation",
      ).routingSelfMs,
    ).toBe(0)
  } finally {
    await rm(outDir, { recursive: true })
  }
})
