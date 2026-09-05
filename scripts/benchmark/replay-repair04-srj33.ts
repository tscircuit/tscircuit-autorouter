import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

type ReplayResult = {
  sample: string
  inputSha256: string
  solved: boolean
  timedOut: boolean
  elapsedTimeMs: number
  baselineReplayMatches: boolean
  relaxedErrors?: object[]
  strictErrors?: object[]
  error?: string
  [key: string]: unknown
}

const [baselineDirectory, outputDirectory, frozenBundle, concurrencyArgument = "2", sampleSelection = ""] = process.argv.slice(2)
if (!baselineDirectory || !outputDirectory || !frozenBundle) {
  throw new Error("Usage: bun scripts/benchmark/replay-repair04-srj33.ts baseline-directory output-directory frozen-replay.js [concurrency] [comma-separated-samples]")
}
const baselineDir = resolve(baselineDirectory)
const outDir = resolve(outputDirectory)
const bundle = resolve(frozenBundle)
const concurrency = Number(concurrencyArgument)
if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error("Concurrency must be a positive integer")
const bundleSha256 = createHash("sha256").update(await readFile(bundle, "utf8")).digest("hex")
await mkdir(outDir, { recursive: true })
const configurationPath = resolve(outDir, "configuration.json")
if (await Bun.file(configurationPath).exists()) {
  const configuration = await Bun.file(configurationPath).json()
  if (configuration.bundleSha256 !== bundleSha256) throw new Error("Output directory belongs to a different solver bundle; use a new directory")
} else {
  await writeFile(configurationPath, JSON.stringify({ bundleSha256, bundle, concurrency,
    datasetCommit: "f566b62be0f83395d9ab63ddc068f9d645b68b16", effort: 1,
    execution: "Exact-output-validated post-repair03 checkpoint replay through the real Pipeline9 stages",
    timing: "Replay timings exclude upstream routing and must not be compared to full-solve baseline timings",
    createdAt: new Date().toISOString(), bunVersion: Bun.version,
  }, null, 2))
}
const baseline = await Bun.file(resolve(baselineDir, "summary.json")).json() as {
  results: Array<{ sample: string; inputSha256: string; solved: boolean; timedOut: boolean;
    elapsedTimeMs: number; error?: string; relaxedErrors?: object[]; strictErrors?: object[] }>
}
const selected = sampleSelection.split(",").filter(Boolean)
if (new Set(selected).size !== selected.length) throw new Error("Sample selection contains duplicates")
for (const sample of selected) {
  if (!baseline.results.some((result) => result.sample === sample)) throw new Error(`Unknown sample ${sample}`)
}
const queue = [...baseline.results].filter((result) => selected.length === 0 || selected.includes(result.sample))
  .sort((a, b) => selected.length > 0
    ? selected.indexOf(a.sample) - selected.indexOf(b.sample)
    : a.elapsedTimeMs - b.elapsedTimeMs)
const results: ReplayResult[] = []
let saving = Promise.resolve()
const saveSummary = (): Promise<void> => {
  const ordered = [...results].sort((a, b) => a.sample.localeCompare(b.sample))
  const content = JSON.stringify({ kind: "checkpoint-replay", mode: "candidate",
    datasetCommit: "f566b62be0f83395d9ab63ddc068f9d645b68b16", denominator: 37,
    evaluated: ordered.length, complete: ordered.length === 37, bundleSha256,
    solved: ordered.filter((result) => result.solved).length,
    relaxedPassed: ordered.filter((result) => result.solved && result.relaxedErrors?.length === 0).length,
    strictPassed: ordered.filter((result) => result.solved && result.strictErrors?.length === 0).length,
    baselineReplayMatches: ordered.filter((result) => result.baselineReplayMatches).length,
    results: ordered,
  }, null, 2)
  saving = saving.then(() => writeFile(resolve(outDir, "summary.json"), content))
  return saving
}
const runReplay = async (sample: string, mode: string, expectedBaseline?: string): Promise<void> => {
  const output = resolve(outDir, `${sample}.${mode}.json`)
  const log = Bun.file(resolve(outDir, `${sample}.${mode}.log`))
  const child = Bun.spawn([process.execPath, bundle, resolve(baselineDir, `${sample}.post-repair03.json`),
    mode, output, ...(expectedBaseline ? [expectedBaseline] : [])], { stdout: log, stderr: log })
  let timedOut = false
  const timeout = setTimeout(() => { timedOut = true; child.kill("SIGKILL") }, 1800000)
  const code = await child.exited
  clearTimeout(timeout)
  if (code !== 0) throw new Error(`${timedOut ? "Timeout: " : ""}${mode} replay ${sample} exited ${code}; see ${sample}.${mode}.log`)
}
await Promise.all(Array.from({ length: concurrency }, async (): Promise<void> => {
  while (queue.length > 0) {
    const before = queue.shift()!
    const resultPath = resolve(outDir, `${before.sample}.result.json`)
    let result: ReplayResult
    if (await Bun.file(resultPath).exists()) {
      result = await Bun.file(resultPath).json()
    } else {
      const start = performance.now()
      result = { sample: before.sample, inputSha256: before.inputSha256,
        solved: false, timedOut: false, elapsedTimeMs: 0, baselineReplayMatches: false }
      try {
        if (!before.solved) throw new Error(`Full baseline did not solve: ${before.error}`)
        console.log(`START ${before.sample}`)
        await runReplay(before.sample, "baseline", resolve(baselineDir, `${before.sample}.output.json`))
        const restored = await Bun.file(resolve(outDir, `${before.sample}.baseline.json.result.json`)).json()
        if (restored.relaxedErrors.length !== before.relaxedErrors?.length || restored.strictErrors.length !== before.strictErrors?.length) {
          throw new Error("Disabled replay DRC counts differ from the full baseline")
        }
        result.baselineReplayMatches = true
        result.baselineReplayByteExact = restored.baselineMatches
        result.baselineReplayMaximumNumericDifference = restored.maximumNumericDifference
        await runReplay(before.sample, "candidate")
        const after = await Bun.file(resolve(outDir, `${before.sample}.candidate.json.result.json`)).json()
        if (after.inputSha256 !== before.inputSha256) throw new Error("Replay input hash changed")
        Object.assign(result, after, { sample: before.sample, solved: true, baselineReplayMatches: true })
      } catch (error) {
        result.error = error instanceof Error ? error.message : String(error)
        result.timedOut = result.error.startsWith("Timeout: ")
      }
      result.validationAndReplayElapsedTimeMs = performance.now() - start
      await writeFile(resultPath, JSON.stringify(result, null, 2))
    }
    results.push(result)
    console.log(JSON.stringify({ sample: result.sample, solved: result.solved,
      baselineMatches: result.baselineReplayMatches, relaxedErrors: result.relaxedErrors?.length,
      strictErrors: result.strictErrors?.length, evaluated: results.length, error: result.error }))
    await saveSummary()
  }
}))
await saveSummary()
