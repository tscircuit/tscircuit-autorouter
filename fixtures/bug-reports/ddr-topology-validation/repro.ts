import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { gunzipSync } from "node:zlib"
import type { AnyCircuitElement } from "circuit-json"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"

const board = process.argv[2] ?? "stmp157"
if (board !== "stmp157" && board !== "a64") {
  throw new Error("Choose stmp157 or a64")
}

const inputPaths = {
  stmp157: new URL(
    "../../../tests/fixtures/assets/stmp157-remaining-mesh/input.srj.json.gz",
    import.meta.url,
  ),
  a64: new URL("./a64.input.srj.json.gz", import.meta.url),
}
const inputSrj: SimpleRouteJson = JSON.parse(
  gunzipSync(Uint8Array.from(readFileSync(inputPaths[board]))).toString("utf8"),
)
const preloadedCircuitPath = new URL(
  `./${board}.preloaded.circuit.json.gz`,
  import.meta.url,
)
const preloadedCircuit: AnyCircuitElement[] = JSON.parse(
  gunzipSync(Uint8Array.from(readFileSync(preloadedCircuitPath))).toString(
    "utf8",
  ),
)
const outputDir =
  process.argv[3] ?? `debug-output/ddr-topology-validation/${board}`
mkdirSync(outputDir, { recursive: true })
// This is the actual preceding core output: 32 DQ signals, not the remaining nets.
writeFileSync(
  path.join(outputDir, "board.svg"),
  convertCircuitJsonToPcbSvg(preloadedCircuit, {
    backgroundColor: "white",
    width: 1400,
    height: 1000,
  }),
)

const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(inputSrj, {
  cacheProvider: null,
  effort: 1,
})
const started = performance.now()
while (!solver.solved && !solver.failed) {
  if (solver.topologyMergingSolver?.solved) break
  solver.step()
}
if (solver.failed) throw new Error(solver.error ?? "Pipeline failed")
const merger = solver.topologyMergingSolver
if (!merger?.solved) throw new Error("Topology merging did not complete")
const result = {
  board,
  elapsedMs: performance.now() - started,
  stats: merger.stats,
  meshSha256: createHash("sha256")
    .update(JSON.stringify(merger.getOutput()))
    .digest("hex"),
}
writeFileSync(
  path.join(outputDir, "result.json"),
  JSON.stringify(result, null, 2),
)
console.log(JSON.stringify(result))
