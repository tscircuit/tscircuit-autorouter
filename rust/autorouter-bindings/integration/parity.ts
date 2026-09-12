import { importReference, tsReferenceRoot } from "./tsReference"
import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as samples from "dataset-srj18"
import type { SimpleRouteJson } from "../../../lib/types"

const sampleNumber = process.argv[2] ?? "16"
const sampleName = `sample${String(Number(sampleNumber)).padStart(3, "0")}`
const backend = process.argv[3]
if (backend) {
  assert.ok(backend === "typescript" || backend === "wasm")
  const { AutoroutingPipelineSolver9_PreloadedTraceGraph } = backend === "typescript"
    ? await importReference<typeof import("../../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph")>("lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph.ts")
    : await import("../../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph")
  const sample = (samples as Record<string, unknown>)[sampleName] as SimpleRouteJson
  assert.ok(sample, `Unknown SRJ18 sample ${sampleName}`)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(structuredClone(sample), { effort: 1 })
  let thrown: string | undefined
  try {
    solver.solve()
  } catch (error) {
    thrown = String(error)
  }
  await writeFile(process.argv[4]!, JSON.stringify({
    solved: solver.solved,
    failed: solver.failed,
    error: solver.error,
    thrown,
    iterations: solver.iterations,
    highDensityIterations: solver.highDensityRouteSolver?.iterations,
    traces: solver.solved ? solver.getOutputSimplifiedPcbTraces() : undefined,
  }))
} else {
  const directory = await mkdtemp(join(tmpdir(), "high-density-parity-"))
  try {
    // Separate processes prevent the first run from warming global route caches.
    for (const variant of ["typescript", "wasm"]) {
      const child = Bun.spawn([process.execPath, ...(variant === "typescript" ? ["--tsconfig-override", `${tsReferenceRoot}/tsconfig.json`] : []), import.meta.path, sampleNumber, variant, join(directory, `${variant}.json`)], {
        stdout: "inherit", stderr: "inherit", cwd: variant === "typescript" ? tsReferenceRoot : undefined,
      })
      assert.equal(await child.exited, 0, `${sampleName}/${variant} exited unsuccessfully`)
    }
    const expected = await readFile(join(directory, "typescript.json"))
    const actual = await readFile(join(directory, "wasm.json"))
    assert.deepEqual(JSON.parse(actual.toString()), JSON.parse(expected.toString()), "solver state, iterations and traces")
    assert.ok(expected.equals(actual), "serialized solver state and final trace bytes differ")
    console.log(`${sampleName}: identical final trace bytes and iterations`)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
