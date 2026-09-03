import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { expect, test } from "bun:test"
import { recoverCompletedProblemIds } from "../scripts/generate-trace-simplification-dataset-01"

test("resumes valid JSONL records and truncates an interrupted final write", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "simplification-dataset-"))
  const outputPath = path.join(directory, "dataset.jsonl")
  const first = {
    schemaVersion: 1,
    problemId: "dataset01:circuit001",
    input: {},
    output: {},
  }
  const second = {
    schemaVersion: 1,
    problemId: "dataset01:circuit002",
    input: {},
    output: {},
  }
  await writeFile(
    outputPath,
    `${JSON.stringify(first)}\n${JSON.stringify(second)}\n{"schemaVersion":1`,
  )

  const completed = await recoverCompletedProblemIds(outputPath)

  expect([...completed]).toEqual([
    "dataset01:circuit001",
    "dataset01:circuit002",
  ])
  expect(await readFile(outputPath, "utf8")).toBe(
    `${JSON.stringify(first)}\n${JSON.stringify(second)}\n`,
  )
})
