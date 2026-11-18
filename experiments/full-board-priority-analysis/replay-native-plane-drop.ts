import { FanoutSolver } from "./lib/index"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"

const [inputPath, output] = process.argv.slice(2)
mkdirSync(output, { recursive: true })
const serialized = gunzipSync(new Uint8Array(readFileSync(inputPath))).toString()
const captured = JSON.parse(serialized)
const started = performance.now()
const solver = new FanoutSolver(captured.solverParams, captured.solverOptions)
while (!solver.solved && !solver.failed) {
  if (performance.now() - started > 900_000) throw new Error("Native fanout diagnostic exceeded 15 minutes")
  solver.step()
}
const graphics = solver.visualize()
const report = {
  inputSha256: createHash("sha256").update(serialized).digest("hex"),
  elapsedMs: performance.now() - started,
  solved: solver.solved,
  failed: solver.failed,
  error: solver.error,
  iterations: solver.iterations,
  stats: solver.stats,
  options: captured.solverOptions,
  inputConnections: captured.solverParams.connections.length,
}
writeFileSync(`${output}/report.json`, JSON.stringify(report, null, 2))
writeFileSync(`${output}/fanout.graphics.json`, JSON.stringify(graphics))
writeFileSync(`${output}/fanout.svg`, getSvgFromGraphicsObject(graphics, { backgroundColor: "white", svgWidth: 1400, svgHeight: 1100 }))
console.log("NATIVE_PLANE_DROP_RESULT", JSON.stringify(report))
