import { readFileSync, writeFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { resolve } from "node:path"
import { createHash } from "node:crypto"

const variants = await Promise.all(["before", "merged", "optimized"].map(async (name) => ({
  name,
  Solver: (await import(resolve(`../srj18-${name}/lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver.ts`))).UniformPortDistributionSolver,
})))
const inputs = Object.entries(JSON.parse(gunzipSync(readFileSync(new URL("./inputs.json.gz", import.meta.url))).toString()))
const samples: Record<string, number[]> = Object.fromEntries(variants.map(({ name }) => [name, []]))
const solveSamples: Record<string, number[]> = Object.fromEntries(variants.map(({ name }) => [name, []]))
const hashes = new Map<string, string>()
for (let round = -2; round < 10; round++) {
  const order = round % 2 === 0 ? variants : [...variants].reverse()
  for (const { name, Solver } of order) {
    let elapsed = 0
    let solveElapsed = 0
    for (const [scenario, raw] of inputs) {
      const input = { ...raw as object, isPortPointClear: name === "optimized" ? undefined : () => true }
      const start = performance.now()
      const solver = new Solver(input)
      const solveStart = performance.now()
      solver.solve()
      const end = performance.now()
      if (!solver.solved || solver.failed) throw new Error(`${name}: ${scenario} failed`)
      elapsed += end - start
      solveElapsed += end - solveStart
      if (round === -2) {
        const hash = createHash("sha256").update(JSON.stringify(solver.getOutput())).digest("hex")
        if (hashes.has(scenario) && hashes.get(scenario) !== hash) throw new Error(`${scenario} output mismatch`)
        hashes.set(scenario, hash)
      }
    }
    if (round >= 0) {
      samples[name]!.push(elapsed)
      solveSamples[name]!.push(solveElapsed)
    }
    console.log("STAGE_PASS " + JSON.stringify({ round, name, elapsed, solveElapsed }))
    Bun.gc(true)
  }
}
const median = (values: number[]): number => {
  const sorted = [...values].sort((a,b) => a - b)
  return (sorted[4]! + sorted[5]!) / 2
}
const result = { samples, solveSamples, outputMatches: hashes.size, medians: Object.fromEntries(variants.map(({ name }) => [name, { constructorAndSolveMs: median(samples[name]!), solveMs: median(solveSamples[name]!) }])) }
writeFileSync("stage-result.json", JSON.stringify(result, null, 2))
console.log("STAGE_RESULT " + JSON.stringify(result))
