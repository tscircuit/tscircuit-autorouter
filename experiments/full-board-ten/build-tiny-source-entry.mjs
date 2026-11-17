import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

const [sourceArgument, outputArgument] = process.argv.slice(2)
if (!sourceArgument || !outputArgument) throw new Error("Expected AR_SOURCE OUTPUT")
const source = resolve(sourceArgument)
const output = resolve(outputArgument)
const require = createRequire(join(source, "package.json"))
const { build } = require("tsup")
const metadata = JSON.parse(readFileSync(join(source, "package.json"), "utf8"))
mkdirSync(output, { recursive: true })
let effectiveOptions
// The public entry uses the repository's actual tsup ESM/terser/map build.
// Worker entries stay published: these runs use Core's synchronous local solver.
await build({
  config: false,
  entry: { index: "lib/index.ts" },
  platform: "node",
  format: ["esm"],
  minify: "terser",
  sourcemap: true,
  tsconfig: join(source, "tsconfig.json"),
  outDir: output,
  external: ["@tscircuit/core", "circuit-to-svg"],
  esbuildOptions(options) {
    assert.deepEqual(options.mainFields, ["module", "main"])
    assert.equal(options.target, "esnext")
    assert.equal(options.conditions, undefined)
    options.metafile = true
    effectiveOptions = { mainFields: options.mainFields, target: options.target, conditions: null, format: options.format, platform: options.platform }
  },
  esbuildPlugins: [{
    name: "record-source-qualification-inputs",
    setup(builder) {
      builder.onEnd(result => {
        assert(result.metafile)
        writeFileSync(join(output, "metafile.json"), JSON.stringify(result.metafile, null, 2) + "\n")
      })
    },
  }],
})
assert(effectiveOptions)
assert.deepEqual(readdirSync(output).filter(name => name.endsWith(".js")), ["index.js"])
writeFileSync(join(output, "compiler.json"), JSON.stringify({
  tsup: require("tsup/package.json").version,
  esbuild: require("esbuild/package.json").version,
  terser: require("terser/package.json").version,
  entry: "lib/index.ts", minify: "terser", sourcemap: true,
  external: [...Object.keys(metadata.dependencies), "@tscircuit/core", "circuit-to-svg"],
  effectiveOptions,
}, null, 2) + "\n")
