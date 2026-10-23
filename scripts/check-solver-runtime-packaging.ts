import { strict as assert } from "node:assert"
import { cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runInNewContext } from "node:vm"
import { build as buildBrowser } from "esbuild"

const repo = Bun.fileURLToPath(new URL("../", import.meta.url))
const temporary = mkdtempSync(join(tmpdir(), "pipeline9-runtime-package-"))
const input = {
  layerCount: 2,
  minTraceWidth: 0.1,
  obstacles: [],
  bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
  connections: [
    {
      name: "signal-a",
      pointsToConnect: [
        { x: -3, y: -1, layer: "top" },
        { x: 3, y: -1, layer: "top" },
      ],
    },
    {
      name: "signal-b",
      pointsToConnect: [
        { x: -3, y: 1, layer: "top" },
        { x: 3, y: 1, layer: "top" },
      ],
    },
  ],
}

async function run(args: string[], cwd = temporary): Promise<void> {
  const child = Bun.spawn(args, { cwd, stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr, status] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (status !== 0) throw new Error(args.join(" ") + "\n" + stdout + stderr)
}

async function bundle(
  path: string,
  target: "node" | "bun" | "browser",
  format: "esm" | "cjs" | "iife",
  external: string[] = [],
): Promise<string> {
  if (target === "browser") {
    const result = await buildBrowser({
      entryPoints: [path],
      bundle: true,
      platform: "browser",
      format,
      minify: true,
      write: false,
    })
    return result.outputFiles[0]!.text
  }
  const build = await Bun.build({
    entrypoints: [path],
    target,
    format,
    external,
    minify: true,
    splitting: false,
  })
  if (!build.success || build.outputs.length !== 1)
    throw new AggregateError(build.logs, "Consumer bundle failed")
  return build.outputs[0]!.text()
}

try {
  await run(
    [
      process.execPath,
      "pm",
      "pack",
      "--ignore-scripts",
      "--filename",
      join(temporary, "package.tgz"),
    ],
    repo,
  )
  const installed = join(
    temporary,
    "node_modules/@tscircuit/capacity-autorouter",
  )
  mkdirSync(installed, { recursive: true })
  await run([
    "tar",
    "-xzf",
    join(temporary, "package.tgz"),
    "--strip-components=1",
    "-C",
    installed,
  ])
  // Materialize the emitted runtime dependencies, never symlink the checkout.
  for (const name of ["object-hash", "@tscircuit/solver-utils"]) {
    cpSync(
      join(repo, "node_modules", name),
      join(temporary, "node_modules", name),
      { recursive: true, dereference: true },
    )
  }
  // Bundle the real graphics-debug peer/dependencies for this isolated package check.
  const graphics = join(temporary, "node_modules/graphics-debug")
  mkdirSync(graphics, { recursive: true })
  await Bun.write(
    join(graphics, "package.json"),
    JSON.stringify({ type: "module", exports: "./index.js" }),
  )
  await Bun.write(
    join(graphics, "index.js"),
    await bundle(
      Bun.fileURLToPath(import.meta.resolve("graphics-debug")),
      "browser",
      "esm",
    ),
  )
  await Bun.write(
    join(temporary, "package.json"),
    JSON.stringify({ type: "module" }),
  )
  for (const platform of ["bun", "node"] as const) {
    const entry = join(temporary, platform + ".ts")
    await Bun.write(
      entry,
      `
import { strict as assert } from "node:assert"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph as Pipeline9 } from "@tscircuit/capacity-autorouter"
import { createAutorouterSolverRuntime } from "@tscircuit/capacity-autorouter/runtime/${platform}"
function deterministicStats(stats: Record<string, unknown>): Record<string, unknown> {
  const result = { ...stats }
  // Timing remains observable, but separate serial/worker runs cannot match it.
  for (const key of [
    "learnedComputeElapsedMs",
    "learnedComputePredictionElapsedMs",
    "learnedComputeValidationElapsedMs",
    "learnedComputePortfolioOverheadMs",
  ]) {
    assert.ok(
      typeof result[key] === "number" &&
        Number.isFinite(result[key]) &&
        result[key] >= 0,
    )
    delete result[key]
  }
  return result
}
async function verify() {
const input = ${JSON.stringify(input)}
const serial = new Pipeline9(structuredClone(input), {effort: 0.1, cacheProvider: null})
serial.solve()
assert.equal(serial.solved, true)
const runtime = createAutorouterSolverRuntime({workerCount: 2, requireWorker: true})
let dispatchCount = 0
const countingRuntime = {
  executeAsync(Solver, input) { dispatchCount++; return runtime.executeAsync(Solver, input) },
}
try {
  const solver = new Pipeline9(structuredClone(input), {effort: 0.1, cacheProvider: null})
  await solver.solveAsync(countingRuntime)
  assert.equal(solver.solved, true)
  assert.ok(dispatchCount > 0, "Test must actually dispatch registered solver tasks")
  assert.equal(JSON.stringify(solver.getOutputSimpleRouteJson()), JSON.stringify(serial.getOutputSimpleRouteJson()))
  assert.equal(solver.iterations, serial.iterations)
  assert.deepEqual(
    deterministicStats(solver.highDensityRouteSolver.stats),
    deterministicStats(serial.highDensityRouteSolver.stats),
  )
} finally { await runtime.dispose() }
}
verify().catch(error => { console.error(error); process.exitCode = 1 })
`,
    )
    for (const rebundled of [false, true]) {
      // CJS handles legacy CommonJS dependencies when inlining the entire Node graph.
      const format = platform === "node" && rebundled ? "cjs" : "esm"
      const output = join(
        temporary,
        platform + "-" + rebundled + (format === "cjs" ? ".cjs" : ".mjs"),
      )
      await Bun.write(
        output,
        await bundle(
          entry,
          platform,
          format,
          rebundled
            ? []
            : [
                "@tscircuit/capacity-autorouter",
                "@tscircuit/capacity-autorouter/*",
              ],
        ),
      )
      await run([platform === "node" ? "node" : process.execPath, output])
      console.log(
        "Packed " +
          platform +
          " Pipeline9 parity passed (rebundled=" +
          rebundled +
          ")",
      )
    }
  }
  const browserEntry = join(temporary, "browser.ts")
  await Bun.write(
    browserEntry,
    `
import { AutoroutingPipelineSolver9_PreloadedTraceGraph as Pipeline9 } from "@tscircuit/capacity-autorouter"
globalThis.checkPipeline = async () => {
  const solver = new Pipeline9(${JSON.stringify(input)}, {effort: 0.1, cacheProvider: null})
  await solver.solveAsync()
  return solver.solved
}
`,
  )
  const browser = await bundle(browserEntry, "browser", "iife")
  assert.ok(!browser.includes("node:worker_threads"))
  // The default entry must not pull an embedded worker payload into eval/browser bundles.
  assert.ok(!browser.includes("Threaded SolverRuntime requires Bun"))
  const context: Record<string, any> = {
    console,
    performance,
    structuredClone,
    MessageChannel,
    TextEncoder,
    TextDecoder,
    setTimeout,
    clearTimeout,
    URL,
  }
  runInNewContext(browser, context)
  assert.equal(await context.checkPipeline(), true)
  console.log("Packed browser Pipeline9.solveAsync passed")
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
