import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { Pipeline9HighDensityForceImproveSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityForceImproveSolver"

type CapturedInput = {
  input: ConstructorParameters<typeof Pipeline9HighDensityForceImproveSolver>[0]
}

test("H3 DDR force output matches the recorded original solver", async (): Promise<void> => {
  const captured = JSON.parse(
    gunzipSync(
      Uint8Array.from(
        readFileSync(
          new URL(
            "../fixtures/h3-ddr-cmn9-force-input.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString(),
  ) as CapturedInput
  const originalInput = JSON.stringify(captured.input)
  const solver = new Pipeline9HighDensityForceImproveSolver(captured.input)
  solver.solve()
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  expect(solver.iterations).toBe(1)
  expect(solver.totalStepsPerNode).toBe(20)
  expect(solver.getOutput()).toHaveLength(23)
  const output = JSON.stringify(solver.getOutput())
  // Recorded from the original 27b3392 dependency before indexing.
  expect(Buffer.byteLength(output)).toBe(110746)
  expect(createHash("sha256").update(output).digest("hex")).toBe(
    "201156bd7ea690f5719ddfd845020d8d92e036f4bbc50c1ed0ac969054a781cb",
  )
  expect(JSON.stringify(captured.input)).toBe(originalInput)
  await expect(
    getSvgFromGraphicsObject(solver.visualize(), { backgroundColor: "white" }),
  ).toMatchSvgSnapshot(import.meta.path, { svgName: "output" })
})
