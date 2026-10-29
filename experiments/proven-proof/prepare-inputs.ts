import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

const [repo, configPath, outputDirectory] = process.argv.slice(2) as [string, string, string]
const config = JSON.parse(readFileSync(configPath, "utf8"))
const { loadScenarioBySampleNumber } = await import(
  pathToFileURL(resolve(repo, "scripts/benchmark/scenarios.ts")).href
)
mkdirSync(outputDirectory, { recursive: true })
const manifest: unknown[] = []
for (const item of config.cases) {
  const loaded = await loadScenarioBySampleNumber(item.dataset, item.sample, config.effort)
  const encoded = JSON.stringify(loaded.scenario)
  const filename = `${item.dataset}-${item.sample}.json`
  writeFileSync(resolve(outputDirectory, filename), encoded)
  manifest.push({
    ...item,
    filename,
    scenarioName: loaded.scenarioName,
    totalSamples: loaded.totalSamples,
    inputSha256: createHash("sha256").update(encoded).digest("hex"),
    bytes: Buffer.byteLength(encoded),
  })
}
writeFileSync(resolve(outputDirectory, "manifest.json"), JSON.stringify(manifest, null, 2))
