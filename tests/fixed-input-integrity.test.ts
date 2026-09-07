import { expect, test } from "bun:test"
import { appendFile, copyFile, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  loadFixedInput,
  validateFixedInput,
} from "../scripts/benchmark/fixed-input/loadFixedInput"

test("the benchmark refuses changed fixture bytes and unsupported input features", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fixed-input-integrity-"))
  try {
    for (const file of ["manifest.json", "fixed-input.srj.json"]) {
      await copyFile(
        join(import.meta.dir, "fixtures/allwinner-t113", file),
        join(directory, file),
      )
    }
    const input = await loadFixedInput(join(directory, "manifest.json"))
    expect(input.srj.connections).toHaveLength(138)
    const unsupported = structuredClone(input.srj)
    unsupported.obstacles[0].ccwRotationDegrees = 45
    expect(() => validateFixedInput(unsupported)).toThrow(
      "Unsupported obstacle",
    )
    await appendFile(join(directory, "fixed-input.srj.json"), "\n")
    await expect(
      loadFixedInput(join(directory, "manifest.json")),
    ).rejects.toThrow("SHA256 does not match")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
