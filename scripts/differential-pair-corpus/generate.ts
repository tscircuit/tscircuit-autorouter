import { mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { parseArgs } from "node:util"
import { generateCorpus } from "./generateCorpus"
import type { CorpusManifest, CorpusSample } from "./types"
import { validateCorpus } from "./validateCorpus"

/** Stratify the preview across family, status, and layer transition presence. */
export function selectPilot(samples: CorpusSample[]): CorpusSample[] {
  const strata = new Map<string, CorpusSample>()
  for (const sample of samples) {
    const hasLayerTransition = sample.srj.connections.some((connection) =>
      new Set(connection.pointsToConnect.flatMap((point) => point.layers ?? [point.layer])).size > 1)
    const key = `${sample.provenance.familyId}:${sample.kind}:${sample.provenance.mutation.pairCount}:${hasLayerTransition}`
    if (!strata.has(key)) strata.set(key, sample)
  }
  return [...strata.values()]
}

export function writeCorpus(options: { samples: CorpusSample[]; seed: number; outDir: string }): CorpusManifest {
  const validation = validateCorpus(options.samples)
  if (!validation.valid) throw new Error(validation.errors.join("\n"))
  mkdirSync(resolve(options.outDir, "samples"), { recursive: true })
  const manifest: CorpusManifest = {
    schemaVersion: 1, generatorVersion: 2, seed: options.seed,
    sampleCount: options.samples.length,
    samples: options.samples.map((sample) => ({
      sampleId: sample.sampleId, path: `samples/${sample.sampleId}.json`,
      split: sample.provenance.split, kind: sample.kind,
      familyId: sample.provenance.familyId, fingerprint: sample.fingerprint,
    })),
  }
  for (const sample of options.samples) {
    writeFileSync(resolve(options.outDir, "samples", `${sample.sampleId}.json`), `${JSON.stringify(sample)}\n`)
  }
  writeFileSync(resolve(options.outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`)
  writeFileSync(resolve(options.outDir, "validation.json"), `${JSON.stringify(validation, null, 2)}\n`)
  // GitHub-installable dataset layout: JavaScript entrypoint and lightweight declarations, no transpilation.
  writeFileSync(resolve(options.outDir, "index.js"), options.samples.map((sample, index) =>
    `import wrapped${index} from "./samples/${sample.sampleId}.json" with { type: "json" }\nexport const sample${String(index + 1).padStart(4, "0")} = wrapped${index}.srj`,
  ).join("\n") + "\n")
  writeFileSync(resolve(options.outDir, "index.d.ts"),
    `type Sample = { layerCount: number; minTraceWidth: number; bounds: { minX: number; maxX: number; minY: number; maxY: number }; obstacles: object[]; connections: object[]; differentialPairs?: object[] }\n` +
    options.samples.map((_sample, index) => `export declare const sample${String(index + 1).padStart(4, "0")}: Sample`).join("\n") + "\n")
  writeFileSync(resolve(options.outDir, "package.json"), JSON.stringify({
    name: "differential-pair-corpus", private: true, type: "module", main: "index.js", types: "index.d.ts",
  }, null, 2) + "\n")
  return manifest
}

if (import.meta.main) {
  const { values } = parseArgs({ options: {
    seed: { type: "string", default: "20260928" }, count: { type: "string", default: "2048" },
    out: { type: "string" }, pilot: { type: "boolean", default: false }, help: { type: "boolean", default: false },
  } })
  if (values.help) {
    console.log("Usage: bun scripts/differential-pair-corpus/generate.ts --out <directory> [--count 2048] [--seed 20260928] [--pilot]\n--pilot selects a stratified preview from the requested count; use count >= 80 to include infeasible cases. Generation does not run the autorouter.")
    process.exit(0)
  }
  if (!values.out) throw new Error("Required: --out <directory>")
  const samples = generateCorpus({ seed: Number(values.seed), count: Number(values.count),
    sourceRoot: resolve(import.meta.dir, "../..") })
  const manifest = writeCorpus({ samples: values.pilot ? selectPilot(samples) : samples,
    seed: Number(values.seed), outDir: resolve(values.out) })
  console.log(JSON.stringify({ outDir: resolve(values.out), sampleCount: manifest.sampleCount }))
}
