import { createHash } from "node:crypto"
import { mkdir } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import type { PostProcessingSolverParams } from "@tscircuit/length-matching-solver"
import { createPostProcessingParamsFromSimpleRouteJson } from "./createPostProcessingParamsFromSimpleRouteJson"
import {
  runPairPortfolio,
  type PairStrategy,
  type PortfolioResult,
} from "./runPairPortfolio"
import {
  validateExpandedPair,
  type ExpandedPairConstraint,
} from "./validateExpandedPair"

type Mode = "joint" | "a" | "b" | "all"
type ManifestEntry = {
  id: string
  path: string
  constraints?: ExpandedPairConstraint[]
  sourceKind?: string
}
type Manifest = { cases: ManifestEntry[] }

/** Run identical captured inputs with a shared per-mode budget; never infer missing routed inputs. */
export async function benchmark(): Promise<void> {
  const args = process.argv.slice(2)
  const values = new Map<string, string>()
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]!,
      value = args[index + 1]
    if (!key.startsWith("--") || value === undefined)
      throw new Error(
        "Expected --input or --manifest, --out, --budget-ms and --modes values",
      )
    values.set(key, value)
  }
  const inputPath = values.get("--input"),
    manifestPath = values.get("--manifest")
  if (Boolean(inputPath) === Boolean(manifestPath))
    throw new Error("Provide exactly one --input or --manifest")
  const budgetMs = Number(values.get("--budget-ms") ?? "5000")
  if (!Number.isFinite(budgetMs) || budgetMs <= 0)
    throw new Error("Invalid wall budget")
  const modes = (values.get("--modes") ?? "joint,a,b,all").split(",") as Mode[]
  if (modes.some((mode) => !["joint", "a", "b", "all"].includes(mode)))
    throw new Error("Modes must be joint,a,b,all")
  const destination = resolve(
    values.get("--out") ?? "investigation-output/spine-portfolio",
  )
  const manifest: Manifest = manifestPath
    ? await Bun.file(manifestPath).json()
    : { cases: [{ id: "input", path: resolve(inputPath!) }] }
  const manifestRoot = manifestPath
    ? dirname(resolve(manifestPath))
    : process.cwd()
  if (!Array.isArray(manifest.cases) || manifest.cases.length === 0)
    throw new Error("Manifest must have nonempty cases")
  const ids = new Set<string>()
  for (const entry of manifest.cases) {
    if (!/^[a-zA-Z0-9_-]+$/.test(entry.id) || ids.has(entry.id))
      throw new Error(`Invalid or duplicate case id ${entry.id}`)
    ids.add(entry.id)
  }
  await mkdir(destination, { recursive: true })
  const summary: unknown[] = []
  const implementationDigest = createHash("sha256")
  for (const filename of [
    "benchmark.ts",
    "createPostProcessingParamsFromSimpleRouteJson.ts",
    "runPairPortfolio.ts",
    "aFamilySpine.ts",
    "bFamilySpine.ts",
    "prepareSpineTerminals.ts",
    "validateExpandedPair.ts",
  ]) {
    implementationDigest.update(filename)
    implementationDigest.update(
      await Bun.file(resolve(import.meta.dir, filename)).text(),
    )
  }
  const implementationHash = implementationDigest.digest("hex")
  const revision = Bun.spawnSync(["git", "rev-parse", "HEAD"])
    .stdout.toString()
    .trim()
  for (const entry of manifest.cases) {
    const path = resolve(manifestRoot, entry.path)
    const text = await Bun.file(path).text()
    const raw = JSON.parse(text)
    const params: PostProcessingSolverParams = raw.hdRoutes
      ? raw
      : raw.traces && raw.differentialPairs
        ? createPostProcessingParamsFromSimpleRouteJson(raw, raw.routingGrid)
        : (() => {
            throw new Error(
              `${entry.id} lacks captured hdRoutes or routed simplified traces`,
            )
          })()
    if (raw.minTraceToPadEdgeClearance !== undefined)
      params.minTraceToPadEdgeClearance = raw.minTraceToPadEdgeClearance
    const constraints: ExpandedPairConstraint[] =
      entry.constraints ?? raw.differentialPairs
    for (const pair of params.differentialPairs) {
      const declared = constraints.find(
        (constraint) =>
          constraint.connectionNames.join("\0") ===
          pair.connectionNames.join("\0"),
      )
      if (declared?.traceGap === undefined) continue
      const members = pair.connectionNames.map((name) => {
        const matches = params.hdRoutes.filter(
          (route) => route.connectionName === name,
        )
        if (matches.length !== 1)
          throw new Error(`${entry.id}: ambiguous pair member ${name}`)
        return matches[0]!
      })
      const spacing =
        declared.traceGap +
        members.reduce((sum, route) => sum + route.traceThickness / 2, 0)
      pair.minimumCenterlineDistance = spacing
      pair.maximumCenterlineDistance = spacing
    }
    const inputHash = createHash("sha256").update(text).digest("hex")
    const paramsHash = createHash("sha256")
      .update(JSON.stringify(params))
      .digest("hex")
    await Bun.write(
      `${destination}/${entry.id}.params.json`,
      JSON.stringify(params, null, 2),
    )
    const initialValidation = validateExpandedPair({
      params,
      candidateHdRoutes: params.hdRoutes,
      constraints,
    })
    const pairNames = new Set(
      params.differentialPairs.flatMap((pair) => pair.connectionNames),
    )
    const inputImmutable = params.hdRoutes.filter(
      (route) => !pairNames.has(route.connectionName),
    )
    for (const mode of modes) {
      const strategies: PairStrategy[] =
        mode === "all" ? ["joint", "a", "b"] : [mode]
      const runParams = structuredClone(params)
      const initialCpu = process.cpuUsage()
      const started = performance.now()
      let result: PortfolioResult | null = null
      let exception: string | null = null
      try {
        result = runPairPortfolio({
          params: runParams,
          constraints,
          strategies,
          budgetMs,
        })
      } catch (error) {
        exception =
          error instanceof Error
            ? `${error.name}: ${error.message}`
            : String(error)
      }
      const solverWallMs = performance.now() - started
      const hdRoutes = result?.hdRoutes ?? structuredClone(params.hdRoutes)
      const validation = validateExpandedPair({
        params,
        candidateHdRoutes: hdRoutes,
        constraints,
      })
      const totalWallMs = performance.now() - started
      const cpu = process.cpuUsage(initialCpu)
      const notes =
        result?.candidates.flatMap((candidate) => candidate.notes) ?? []
      const row = {
        caseId: entry.id,
        mode,
        revision,
        implementationHash,
        runtime: {
          bun: Bun.version,
          platform: process.platform,
          arch: process.arch,
        },
        inputHash,
        paramsHash,
        sourceKind: entry.sourceKind ?? "captured-or-legacy-fixture",
        seed: 0,
        budgetMs,
        solverWallMs,
        totalWallMs,
        validationWallMs: totalWallMs - solverWallMs,
        solverBudgetOvershootMs: Math.max(0, solverWallMs - budgetMs),
        totalBudgetOvershootMs: Math.max(0, totalWallMs - budgetMs),
        cpuUserMs: cpu.user / 1000,
        cpuSystemMs: cpu.system / 1000,
        outputAvailable: hdRoutes.length > 0,
        outputOrigin: exception
          ? "exception-input-incumbent"
          : result?.winner
            ? "validated-candidate"
            : "best-effort-incumbent",
        inputUnchanged: JSON.stringify(runParams) === JSON.stringify(params),
        outputUnchanged:
          JSON.stringify(hdRoutes) === JSON.stringify(params.hdRoutes),
        immutableRoutesPreserved:
          JSON.stringify(
            hdRoutes.filter((route) => !pairNames.has(route.connectionName)),
          ) === JSON.stringify(inputImmutable),
        fixedTracesPreserved:
          JSON.stringify(runParams.traces) === JSON.stringify(params.traces),
        status: result?.status ?? "exception",
        winner: result?.winner ?? null,
        steps: result?.steps ?? null,
        unfinished: result?.unfinished ?? strategies,
        unsupported:
          validation.status === "unsupported" ||
          notes.some((note) =>
            /unsupported|exceeds.*window|does not support/i.test(note),
          ),
        notes,
        exception,
        initialValidation,
        validation,
        candidates: result?.candidates ?? [],
      }
      summary.push(row)
      await Bun.write(
        `${destination}/${entry.id}.${mode}.json`,
        JSON.stringify({ ...row, hdRoutes }, null, 2),
      )
      await Bun.write(
        `${destination}/summary.json`,
        JSON.stringify(summary, null, 2),
      )
      console.log(JSON.stringify(row))
    }
  }
}

if (import.meta.main) await benchmark()
