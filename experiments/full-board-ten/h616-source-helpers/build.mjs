import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { readdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

const [sourceArgument, outputArgument] = process.argv.slice(2)
assert(sourceArgument && outputArgument)
const source = resolve(sourceArgument)
const output = resolve(outputArgument)
const require = createRequire(join(source, "package.json"))
const { build } = require("tsup")
let effectiveOptions
await build({
  config: false,
  entry: { index: "h616-diagnostic-helpers.ts" },
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
    name: "record-helper-source-inputs",
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
  minify: "terser", sourcemap: true, effectiveOptions,
}, null, 2) + "\n")
