import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

const [beforeRoot, afterRoot, inputPath, outputPath] = process.argv.slice(2)
const input = JSON.parse(readFileSync(inputPath, "utf8"))
input.bounds = { minX: -8, maxX: 12, minY: -11, maxY: 9 }
const route = {
  connectionName: "source_net_95",
  rootConnectionName: "source_net_95",
  traceThickness: 0.089,
  viaDiameter: 0.28,
  vias: [],
  route: [
    { x: 1.1310523676080066, y: -8.445141832287852, z: 0 },
    { x: 8.429318671975786, y: -8.445141832287852, z: 0 },
  ],
}
const searches = 25
const runtimes = await Promise.all(
  [beforeRoot, afterRoot].map(async (root) => {
    const library = resolve(root, "node_modules/@tscircuit/repair04/lib")
    const { FindClearancePathSolver } = await import(
      `${library}/FindClearancePathSolver.ts`
    )
    const { ClearancePathConnectivity } = await import(
      `${library}/ClearancePathConnectivity.ts`
    )
    const connectivity = new ClearancePathConnectivity(input)
    return { FindClearancePathSolver, connectivity }
  }),
)
const measurements: Array<{
  variant: string
  trial: number
  elapsedMs: number
  outputSha256: string
}> = []
let expectedOutput: string | undefined
for (let trial = -1; trial < 7; trial++) {
  const order = trial % 2 === 0 ? [0, 1] : [1, 0]
  for (const index of order) {
    const runtime = runtimes[index]!
    const started = performance.now()
    const outputs = []
    for (let search = 0; search < searches; search++) {
      const solver = new runtime.FindClearancePathSolver(
        {
          srj: input,
          routes: [route],
          routeIndex: 0,
          start: route.route[0],
          end: route.route[1],
          bounds: input.bounds,
          traceThickness: route.traceThickness,
          traceClearance: 0.089,
          viaClearance: 0.089,
          gridSize: 0.178,
          heuristicWeight: 3,
          allowLayerChanges: false,
          maxNodes: 30_000,
        },
        runtime.connectivity,
      )
      solver.solve()
      if (solver.failed || !solver.getOutput()) {
        throw new Error(`Native search failed: ${solver.error}`)
      }
      outputs.push({ path: solver.getOutput(), stats: solver.stats })
    }
    const elapsedMs = performance.now() - started
    const outputSha256 = createHash("sha256")
      .update(JSON.stringify(outputs))
      .digest("hex")
    expectedOutput ??= outputSha256
    if (expectedOutput !== outputSha256) {
      throw new Error("Native clearance output or search accounting changed")
    }
    if (trial >= 0) {
      measurements.push({
        variant: index === 0 ? "before" : "after",
        trial,
        elapsedMs,
        outputSha256,
      })
    }
  }
}
const report = {
  searchesPerTrial: searches,
  measurements,
  inputSha256: createHash("sha256")
    .update(readFileSync(inputPath))
    .digest("hex"),
}
writeFileSync(outputPath, JSON.stringify(report, null, 2))
console.log("CONNECTIVITY2410_KERNEL_RESULT", JSON.stringify(report))
