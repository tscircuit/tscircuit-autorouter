import { createHash } from "node:crypto"
import { resolve, sep } from "node:path"
import { RELAXED_DRC_OPTIONS } from "../../lib/testing/drcPresets"
import { getDrcErrors } from "../../lib/testing/getDrcErrors"
import { convertToCircuitJson } from "../../lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson } from "../../lib/types"

type SavedOutputEntry = {
  sample: string
  outputFile: string
  outputSha256: string
  contextFile: string
  contextSha256: string
}

type SavedOutputManifest = {
  schemaVersion: 1
  kind: "repair04-passing-final-outputs"
  scope: string
  benchmark: {
    bundleSha256: string
    datasetCommit: string
    denominators: { allDatasetBoards: number; currentDatasetBoards: number }
  }
  verificationProvenance: {
    checksVersion: string
    repositoryFiles: Record<string, string>
  }
  samples: SavedOutputEntry[]
}

type ConversionContext = {
  originalSrj: SimpleRouteJson
  srjWithPointPairs: SimpleRouteJson
}

type VerificationResult = {
  sample: string
  outputSha256: string
  contextSha256: string
  circuitElementCount: number
  strictErrorCount: number
  relaxedErrorCount: number
  strictErrors: ReturnType<typeof getDrcErrors>["errors"]
  relaxedErrors: ReturnType<typeof getDrcErrors>["errors"]
}

async function readHashedFile(
  directory: string,
  relativePath: string,
  expectedSha256: string,
): Promise<Buffer> {
  const path = resolve(directory, relativePath)
  if (!path.startsWith(`${resolve(directory)}${sep}`)) {
    throw new Error(`Manifest path escapes its directory: ${relativePath}`)
  }
  if (!/^[a-f0-9]{64}$/.test(expectedSha256)) {
    throw new Error(`Invalid SHA-256 for ${relativePath}`)
  }
  const bytes = Buffer.from(await Bun.file(path).arrayBuffer())
  const actualSha256 = createHash("sha256")
    .update(new Uint8Array(bytes))
    .digest("hex")
  if (actualSha256 !== expectedSha256) {
    throw new Error(`SHA-256 mismatch for ${relativePath}`)
  }
  return bytes
}

async function verifySavedOutputs(directory: string): Promise<void> {
  const manifest: SavedOutputManifest = await Bun.file(
    resolve(directory, "manifest.json"),
  ).json()
  if (
    manifest.schemaVersion !== 1 ||
    manifest.kind !== "repair04-passing-final-outputs" ||
    !Array.isArray(manifest.samples) ||
    manifest.samples.length === 0
  ) {
    throw new Error("Expected a version 1 repair04 passing-output manifest")
  }
  const repoRoot = resolve(import.meta.dir, "../..")
  const checksPackage: { version: string } = await Bun.file(
    Bun.resolveSync("@tscircuit/checks/package.json", repoRoot),
  ).json()
  if (checksPackage.version !== manifest.verificationProvenance.checksVersion) {
    throw new Error(
      `Checker version mismatch: installed ${checksPackage.version}, recorded ${manifest.verificationProvenance.checksVersion}`,
    )
  }
  for (const path of [
    "lib/testing/getDrcErrors.ts",
    "lib/testing/drcPresets.ts",
    "lib/testing/utils/convertToCircuitJson.ts",
    "node_modules/@tscircuit/checks/dist/index.js",
  ]) {
    if (!manifest.verificationProvenance.repositoryFiles[path]) {
      throw new Error(`Missing checker provenance: ${path}`)
    }
  }
  for (const [path, sha256] of Object.entries(
    manifest.verificationProvenance.repositoryFiles,
  )) {
    await readHashedFile(repoRoot, path, sha256)
  }

  const results: VerificationResult[] = []
  const samples = new Set<string>()
  for (const entry of manifest.samples) {
    if (!/^sample\d{3}$/.test(entry.sample) || samples.has(entry.sample)) {
      throw new Error(`Invalid or duplicate sample: ${entry.sample}`)
    }
    samples.add(entry.sample)
    const outputBytes = await readHashedFile(
      directory,
      entry.outputFile,
      entry.outputSha256,
    )
    const contextBytes = await readHashedFile(
      directory,
      entry.contextFile,
      entry.contextSha256,
    )
    const output: SimpleRouteJson = JSON.parse(outputBytes.toString("utf8"))
    const context: ConversionContext = JSON.parse(contextBytes.toString("utf8"))
    if (
      !Array.isArray(output.traces) ||
      !Array.isArray(context.originalSrj?.connections) ||
      !Array.isArray(context.srjWithPointPairs?.connections)
    ) {
      throw new Error(
        `Missing output traces or conversion context: ${entry.sample}`,
      )
    }
    // Rebuild circuit-json from saved final geometry. Never read recorded DRC
    // counts, change thresholds, or run the autorouter to reconstruct a result.
    const circuitJson = convertToCircuitJson(
      context.srjWithPointPairs,
      output.traces,
      {
        minTraceWidth: context.originalSrj.minTraceWidth,
        minViaDiameter: context.originalSrj.minViaDiameter,
        originalSrj: context.originalSrj,
        includeOriginalConnections: true,
      },
    )
    const strictErrors = getDrcErrors(circuitJson).errors
    const relaxedErrors = getDrcErrors(circuitJson, RELAXED_DRC_OPTIONS).errors
    results.push({
      sample: entry.sample,
      outputSha256: entry.outputSha256,
      contextSha256: entry.contextSha256,
      circuitElementCount: circuitJson.length,
      strictErrorCount: strictErrors.length,
      relaxedErrorCount: relaxedErrors.length,
      strictErrors,
      relaxedErrors,
    })
  }
  console.log(
    JSON.stringify(
      {
        kind: "Independent saved-output verification; no routing executed",
        scope: manifest.scope,
        benchmark: manifest.benchmark,
        verifiedOutputCount: results.length,
        runtime: {
          bunVersion: Bun.version,
          platform: process.platform,
          architecture: process.arch,
          checksVersion: checksPackage.version,
        },
        checkerOptions: { strict: "defaults", relaxed: RELAXED_DRC_OPTIONS },
        results,
      },
      null,
      2,
    ),
  )
  if (
    results.some(
      (result: VerificationResult): boolean =>
        result.strictErrorCount > 0 || result.relaxedErrorCount > 0,
    )
  ) {
    process.exitCode = 1
  }
}

const directory = process.argv[2]
if (!directory || process.argv.length !== 3) {
  throw new Error(
    "Usage: bun scripts/benchmark/verify-repair04-saved-outputs.ts <extracted-archive-directory>",
  )
}
await verifySavedOutputs(resolve(directory))
