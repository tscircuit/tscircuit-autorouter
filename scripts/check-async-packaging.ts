import { execFileSync } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { runInNewContext } from "node:vm"
import { strict as assert } from "node:assert"
import { build } from "esbuild"
import type { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"

type PackedFile = { filename: string; files: { path: string }[] }
type BrowserApi = { Pipeline9: typeof AutoroutingPipelineSolver9_PreloadedTraceGraph }

const repo = fileURLToPath(new URL("../", import.meta.url))
const temporary = mkdtempSync(join(tmpdir(), "pipeline9-packaging-"))
const input = {
  layerCount: 2, minTraceWidth: 0.1, obstacles: [],
  bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
  connections: [{ name: "signal", pointsToConnect: [{ x: -3, y: 0, layer: "top" }, { x: 3, y: 0, layer: "top" }] }],
}

try {
  const [packed] = JSON.parse(execFileSync("npm", ["--cache", join(temporary, "npm-cache"), "pack", "--ignore-scripts", "--json", "--pack-destination", temporary], { cwd: repo, encoding: "utf8" })) as PackedFile[]
  if (!packed) throw new Error("npm pack did not produce a package")
  for (const asset of ["pipeline9HighDensityWorker.js", "pipeline9NodeRuntime.js"]) {
    assert(packed.files.some((file): boolean => file.path === `dist/${asset}`), `Package is missing ${asset}`)
  }
  const installed = join(temporary, "node_modules/@tscircuit/capacity-autorouter")
  mkdirSync(installed, { recursive: true })
  execFileSync("tar", ["-xzf", join(temporary, packed.filename), "--strip-components=1", "-C", installed])
  // object-hash is the emitted package's sole external JS dependency. Do not
  // link the checkout's node_modules: that would conceal missing package files.
  cpSync(join(repo, "node_modules/object-hash"), join(temporary, "node_modules/object-hash"), { recursive: true, dereference: true })
  writeFileSync(join(temporary, "package.json"), JSON.stringify({ type: "module", peerDependencies: { "@tscircuit/capacity-autorouter": "*" } }))
  const entry = join(temporary, "index.ts")
  writeFileSync(entry, 'export { AutoroutingPipelineSolver9_PreloadedTraceGraph as Pipeline9 } from "@tscircuit/capacity-autorouter"\n')
  // Core keeps its autorouter peer external; reproduce that package boundary.
  await build({ entryPoints: [entry], bundle: true, platform: "node", format: "esm", external: ["@tscircuit/capacity-autorouter"], outfile: join(temporary, "dist/index.js"), logLevel: "silent" })
  writeFileSync(join(temporary, "verify.mjs"), `
import { strict as assert } from "node:assert"
import { Pipeline9 } from "./dist/index.js"
const input = ${JSON.stringify(input)}
const baseline = new Pipeline9(structuredClone(input), { effort: 0.1, cacheProvider: null })
baseline.solve()
assert.equal(baseline.solved, true)
const solver = new Pipeline9(structuredClone(input), { effort: 0.1, cacheProvider: null })
await solver.solveAsync({ workerCount: 2 })
assert.equal(solver.solved, true)
assert.equal(JSON.stringify(solver.getOutputSimpleRouteJson()), JSON.stringify(baseline.getOutputSimpleRouteJson()))
assert.equal(solver.iterations, baseline.iterations)
console.log("Packed consumer passed:", process.versions.bun ? "Bun" : "Node")
`)
  for (const runtime of ["node", "bun"]) {
    console.log(execFileSync(runtime, [join(temporary, "verify.mjs")], { cwd: temporary, encoding: "utf8" }).trim())
  }
  // Browser consumers bundle the class but must never resolve Node builtins or
  // execute the Node runtime loader, even when calling solveAsync().
  const browser = await build({ entryPoints: [entry], bundle: true, platform: "browser", format: "iife", globalName: "BrowserAutorouter", write: false, logLevel: "silent" })
  const api = runInNewContext(`${browser.outputFiles[0]!.text};BrowserAutorouter`, { console, performance, structuredClone, setTimeout, clearTimeout, TextEncoder, TextDecoder, URL }) as BrowserApi
  const solver = new api.Pipeline9(structuredClone(input), { effort: 0.1, cacheProvider: null })
  await solver.solveAsync()
  assert.equal(solver.solved, true)
  console.log("Packed browser bundle and browser solveAsync passed")
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
