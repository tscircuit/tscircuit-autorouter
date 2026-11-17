import { createRequire } from "node:module"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

const [sourceArgument, outputArgument] = process.argv.slice(2)
if (!sourceArgument || !outputArgument) throw new Error("Expected AR_SOURCE OUTPUT")
const source = resolve(sourceArgument)
const output = resolve(outputArgument)
const require = createRequire(join(source, "package.json"))
const { build, version } = require("esbuild")
const metadata = JSON.parse(readFileSync(join(source, "package.json"), "utf8"))
mkdirSync(output, { recursive: true })
// Build the complete public entry. Runtime dependencies remain external, as in
// AR's tsup build; their exact published lock is supplied by bootstrap.py.
const result = await build({
  absWorkingDir: source,
  entryPoints: [join(source, "lib/index.ts")],
  outfile: join(output, "index.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "es2022",
  sourcemap: true,
  metafile: true,
  external: [...Object.keys(metadata.dependencies), "@tscircuit/core", "circuit-to-svg"],
})
writeFileSync(join(output, "metafile.json"), JSON.stringify(result.metafile, null, 2) + "\n")
writeFileSync(join(output, "compiler.json"), JSON.stringify({ esbuild: version, entry: "lib/index.ts", format: "esm", target: "es2022", minify: false, external: Object.keys(metadata.dependencies) }, null, 2) + "\n")
