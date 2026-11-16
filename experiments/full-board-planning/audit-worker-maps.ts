import assert from "node:assert/strict"
import { readFileSync, mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

const [sourceArg, outputArg] = process.argv.slice(2)
if (!sourceArg || !outputArg) throw new Error("Usage: audit-worker-maps.ts SOURCE OUTPUT")
const source = resolve(sourceArg)
const output = resolve(outputArg)
mkdirSync(output, { recursive: true })
const manifests: { path: string; originalMapPath: string; platform: string }[] = []
for (const platform of ["bun", "node"] as const) {
  const generated = readFileSync(join(source, "lib/runtime/generated", `${platform}WorkerSource.ts`), "utf8")
  assert(generated.startsWith("export default "))
  const official: string = JSON.parse(generated.slice("export default ".length).trim())
  const result = await Bun.build({
    entrypoints: [join(source, "lib/runtime", `${platform}.worker.ts`)],
    target: platform,
    format: platform === "bun" ? "esm" : "cjs",
    splitting: false,
    minify: true,
    sourcemap: "external",
  })
  if (!result.success) throw new AggregateError(result.logs, "Diagnostic worker map build failed")
  const maps = result.outputs.filter(file => file.path.endsWith(".map"))
  const bundles = result.outputs.filter(file => !file.path.endsWith(".map"))
  assert.equal(maps.length, 1)
  assert.equal(bundles.length, 1)
  const diagnostic = await bundles[0]!.text()
  // Bun adds these source-map metadata comments after the unchanged worker.
  const withoutMapMetadata = diagnostic
    .replace(/^\/\/# sourceMappingURL=[^\r\n]*(?:\r?\n)?$/m, "")
    .replace(/\n\/\/# debugId=[A-Fa-f0-9-]+\r?\n?$/, "")
  assert.ok(
    withoutMapMetadata === official,
    `${platform} diagnostic JS differs from the official worker (${withoutMapMetadata.length} vs ${official.length} bytes)`,
  )
  writeFileSync(join(output, `${platform}.worker.js`), official)
  writeFileSync(join(output, `${platform}.worker.js.map`), await maps[0]!.text())
  manifests.push({ path: join(output, `${platform}.worker.js.map`), originalMapPath: resolve(maps[0]!.path), platform })
}
writeFileSync(join(output, "map-origins.json"), JSON.stringify(manifests, null, 2))
