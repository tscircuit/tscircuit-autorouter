import { parseArgs } from "node:util"
import {
  cp,
  mkdir,
  readFile,
  readdir,
  unlink,
  writeFile,
} from "node:fs/promises"
import { arch, cpus, platform, release, totalmem } from "node:os"
import { resolve } from "node:path"
import { createHash } from "node:crypto"
import { dataset } from "dataset-srj18"
import { buildProfile } from "./buildProfile"
import { summarizeResults } from "./summarizeResults"
import { summarizeCpuProfiles } from "./summarizeCpuProfiles"
import { renderReportMarkdown } from "./renderReportMarkdown"
import { renderReportHtml } from "./renderReportHtml"

type Mode = "all" | "baseline" | "detailed" | "cpu"

async function relayOutput(
  stream: ReadableStream<Uint8Array>,
): Promise<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let output = ""
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    const text = decoder.decode(chunk.value, { stream: true })
    output += text
    process.stdout.write(text)
  }
  return output + decoder.decode()
}

export async function runProfileBenchmark(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    strict: true,
    options: {
      help: { type: "boolean" },
      sample: { type: "string" },
      limit: { type: "string" },
      repeats: { type: "string", default: "3" },
      effort: { type: "string", default: "1" },
      "out-dir": { type: "string" },
      mode: { type: "string", default: "all" },
      "timeout-seconds": { type: "string", default: "1800" },
      "cpu-interval-us": { type: "string", default: "1000" },
      "cpu-smol": { type: "boolean", default: false },
    },
  })
  if (values.help) {
    console.log(`Profile all 16 SRJ18 samples with Pipeline9, sequentially in fresh processes.

Usage: bun scripts/profile-srj18.ts [options]
  --sample NUM              Select a sample by its numeric ID
  --limit NUM               Select the first NUM samples
  --repeats NUM             Baseline repetitions (default 3)
  --effort NUM              Pipeline9 effort (default 1)
  --mode all|baseline|detailed|cpu  Runs to perform (default all)
  --timeout-seconds NUM     Hard per-process limit (default 1800)
  --cpu-interval-us NUM     Native sample interval (default 1000 microseconds)
  --cpu-smol               Use Bun's lower-memory runtime for CPU runs only
  --out-dir PATH            Destination (default results/runNNN)

Baseline records full stage and high-density node wall times without lifecycle
instrumentation. Detailed additionally records nested solver construction,
step/_step/solve/setup calls, status, iterations, settings and parent IDs using
a temporary instrumented build. CPU records original-source 1ms CPU samples.
All modes start with empty process-local caches. Output/DRC validation runs
after the routing timer. Raw detailed records are gzip-compressed JSON.
No routing parameters, source files or dependency files are modified.`)
    return
  }
  const repeats = Number(values.repeats)
  const effort = Number(values.effort)
  const timeoutMs = Number(values["timeout-seconds"]) * 1000
  const cpuIntervalUs = Number(values["cpu-interval-us"])
  if (!Number.isInteger(cpuIntervalUs) || cpuIntervalUs < 1)
    throw new Error("--cpu-interval-us must be a positive integer")
  if (
    !Number.isInteger(repeats) ||
    repeats < 1 ||
    !Number.isFinite(effort) ||
    effort <= 0 ||
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0
  )
    throw new Error(
      "repeats, effort and timeout must be positive; repeats must be an integer",
    )
  if (!["all", "baseline", "detailed", "cpu"].includes(values.mode!))
    throw new Error(`Unknown mode: ${values.mode}`)
  const mode = values.mode as Mode
  if (values.sample && values.limit)
    throw new Error("Choose --sample or --limit, not both")
  let samples = Object.keys(dataset)
    .filter((key) => /^sample\d{3}$/.test(key))
    .map((key) => Number(key.slice(6)))
    .sort((left, right) => left - right)
  if (values.sample)
    samples = samples.filter((sample) => sample === Number(values.sample))
  if (values.limit) {
    const limit = Number(values.limit)
    if (!Number.isInteger(limit) || limit < 1)
      throw new Error("--limit must be a positive integer")
    samples = samples.slice(0, limit)
  }
  if (!samples.length) throw new Error("No matching samples")
  let outDir: string
  if (values["out-dir"]) {
    outDir = resolve(values["out-dir"])
  } else {
    await mkdir("results", { recursive: true })
    const existing = await readdir("results")
    const next =
      Math.max(
        0,
        ...existing
          .filter((name) => /^run\d+$/.test(name))
          .map((name) => Number(name.slice(3))),
      ) + 1
    outDir = resolve(`results/run${String(next).padStart(3, "0")}`)
  }
  await mkdir(outDir, { recursive: true })
  const existingResults = (await readdir(outDir)).filter(
    (name) =>
      ((mode === "all" || mode === "baseline") &&
        /^baseline-\d+$/.test(name)) ||
      ((mode === "all" || mode === "detailed") && name === "detailed") ||
      ((mode === "all" || mode === "cpu") && name === "cpu"),
  )
  if (existingResults.length)
    throw new Error(
      `Destination already contains ${existingResults.join(", ")}; use a new --out-dir to avoid mixing independent runs`,
    )
  const revision = Bun.spawnSync(["git", "rev-parse", "HEAD"])
    .stdout.toString()
    .trim()
  const branch = Bun.spawnSync(["git", "branch", "--show-current"])
    .stdout.toString()
    .trim()
  const packageJson = await readFile("package.json", "utf8")
  const dependencies: {
    path: string
    name: string
    version: string | null
    packageJsonSha256: string
  }[] = []
  for await (const path of new Bun.Glob("**/package.json").scan(
    "node_modules",
  )) {
    const contents = await readFile(resolve("node_modules", path), "utf8")
    const installed = JSON.parse(contents) as {
      name?: string
      version?: string
    }
    if (installed.name)
      dependencies.push({
        path,
        name: installed.name,
        version: installed.version ?? null,
        packageJsonSha256: createHash("sha256").update(contents).digest("hex"),
      })
  }
  dependencies.sort((left, right) => left.path.localeCompare(right.path))
  await writeFile(
    resolve(outDir, "dependencies.json"),
    JSON.stringify(dependencies, null, 2),
  )
  const manifest = {
    startedAt: new Date().toISOString(),
    revision,
    branch,
    mode,
    samples,
    repeats,
    effort,
    timeoutMs,
    bun: Bun.version,
    bunRevision: Bun.revision,
    cpuIntervalUs,
    cpuSmol: values["cpu-smol"],
    platform: platform(),
    release: release(),
    arch: arch(),
    cpu: cpus()[0]?.model,
    logicalCpuCount: cpus().length,
    totalMemoryBytes: totalmem(),
    packageJsonSha256: createHash("sha256").update(packageJson).digest("hex"),
    lockfilePresent:
      (await Bun.file("bun.lock").exists()) ||
      (await Bun.file("bun.lockb").exists()),
    cachePolicy: "fresh_process_per_sample_and_repetition",
    instrumentationPolicy:
      "temporary_source_transform_no_prototype_replacement",
  }
  await writeFile(
    resolve(outDir, `manifest-${mode}.json`),
    JSON.stringify(manifest, null, 2),
  )
  await writeFile(
    resolve(outDir, "source.patch"),
    Bun.spawnSync(["git", "diff", "HEAD"]).stdout.toString(),
  )
  const detailedEntrypoint =
    mode === "all" || mode === "detailed"
      ? await buildProfile(resolve(outDir, "instrumented"))
      : null
  const originalEntrypoint = `${import.meta.dir}/sample.ts`
  const runs = [
    ...(mode === "all" || mode === "baseline"
      ? Array.from({ length: repeats }, (_, repeat) => ({
          kind: "baseline",
          directory: `baseline-${repeat + 1}`,
          repeat,
        }))
      : []),
    ...(mode === "all" || mode === "detailed"
      ? [{ kind: "detailed", directory: "detailed", repeat: 0 }]
      : []),
    ...(mode === "all" || mode === "cpu"
      ? [{ kind: "cpu", directory: "cpu", repeat: 0 }]
      : []),
  ]
  let runFailures = 0
  for (const run of runs) {
    // Alternate sample order to reduce systematic position/thermal effects.
    const orderedSamples = run.repeat % 2 ? [...samples].reverse() : samples
    for (const sample of orderedSamples) {
      const sampleId = `sample${String(sample).padStart(3, "0")}`
      const sampleDir = resolve(outDir, run.directory)
      await mkdir(sampleDir, { recursive: true })
      const outFile = resolve(sampleDir, `${sampleId}.json`)
      const cpuDir = resolve(sampleDir, sampleId)
      if (run.kind === "cpu") await mkdir(cpuDir, { recursive: true })
      const command = [
        process.execPath,
        ...(run.kind === "cpu"
          ? [
              ...(values["cpu-smol"] ? ["--smol"] : []),
              "--cpu-prof",
              "--cpu-prof-md",
              "--cpu-prof-interval",
              String(cpuIntervalUs),
              "--cpu-prof-dir",
              cpuDir,
            ]
          : []),
        run.kind === "detailed" ? detailedEntrypoint! : originalEntrypoint,
        String(sample),
        String(effort),
        outFile,
      ]
      console.log(`START ${run.directory} ${sampleId}`)
      const processStartMs = performance.now()
      const child = Bun.spawn(command, {
        cwd: process.cwd(),
        env: {
          ...process.env,
          SRJ18_DETAILED_PROFILE: run.kind === "detailed" ? "1" : "0",
        },
        stdout: "pipe",
        stderr: "pipe",
      })
      let timedOut = false
      const timeout = setTimeout(() => {
        timedOut = true
        child.kill("SIGKILL")
      }, timeoutMs)
      const childResults = await Promise.all([
        child.exited,
        relayOutput(child.stdout),
        relayOutput(child.stderr),
      ])
      clearTimeout(timeout)
      const [exitCode, stdout, stderr] = childResults
      const processDurationMs = performance.now() - processStartMs
      const log = `${stdout}${stderr}\nprocessDuration=${(processDurationMs / 1000).toFixed(3)}s exitCode=${exitCode} timedOut=${timedOut}\n`
      await writeFile(resolve(sampleDir, `${sampleId}.log`), log)
      console.log(
        `END ${run.directory} ${sampleId} processDuration=${(processDurationMs / 1000).toFixed(3)}s exitCode=${exitCode} timedOut=${timedOut}`,
      )
      if (exitCode !== 0) {
        runFailures++
        await writeFile(
          resolve(sampleDir, `${sampleId}-failure.json`),
          JSON.stringify(
            { sampleId, exitCode, timedOut, processDurationMs },
            null,
            2,
          ),
        )
      }
      if (run.kind === "detailed" && (await Bun.file(outFile).exists())) {
        await writeFile(
          `${outFile}.gz`,
          Bun.gzipSync(await Bun.file(outFile).arrayBuffer()),
        )
        await unlink(outFile)
      }
      if (run.kind === "cpu") {
        for (const filename of await readdir(cpuDir)) {
          if (!filename.endsWith(".cpuprofile") && !filename.endsWith(".md"))
            continue
          const path = resolve(cpuDir, filename)
          await writeFile(
            `${path}.gz`,
            Bun.gzipSync(await Bun.file(path).arrayBuffer()),
          )
          await unlink(path)
        }
      }
    }
  }
  await cp(
    `${import.meta.dir}/../profile-srj18.ts`,
    resolve(outDir, "profile-srj18.ts"),
  )
  await cp(import.meta.dir, resolve(outDir, "srj18Profile"), {
    recursive: true,
  })
  if (mode === "all" || mode === "cpu") await summarizeCpuProfiles(outDir)
  if (mode === "all" || mode === "baseline") {
    await summarizeResults(outDir)
    await renderReportMarkdown(outDir)
    await renderReportHtml(outDir)
  }
  console.log(`Finished: ${outDir}; process failures=${runFailures}`)
  if (runFailures) process.exitCode = 1
}
