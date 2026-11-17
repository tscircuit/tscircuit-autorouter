import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

const [sourceArgument, outputArgument] = process.argv.slice(2)
assert(sourceArgument && outputArgument, "Expected CORE_SOURCE OUTPUT")
const source = resolve(sourceArgument)
const output = resolve(outputArgument)
const require = createRequire(join(source, "package.json"))
const { build } = require("tsup")
const config = (await import(pathToFileURL(join(source, "tsup.config.ts")).href)).default
assert.deepEqual(config.entry, ["index.ts"])
assert.deepEqual(config.format, ["esm"])
mkdirSync(output, { recursive: true })
let effectiveOptions
await build({
  ...config,
  config: false,
  // Core publishes with tsup-node, whose CLI supplies this exact option.
  skipNodeModulesBundle: true,
  dts: false,
  sourcemap: true,
  outDir: output,
  esbuildOptions(options) {
    options.metafile = true
    effectiveOptions = {
      mainFields: options.mainFields,
      target: options.target,
      conditions: options.conditions ?? null,
      format: options.format,
      platform: options.platform,
      splitting: options.splitting,
      external: options.external,
    }
  },
  esbuildPlugins: [{
    name: "record-core-qualification-inputs",
    setup(builder) {
      builder.onEnd(result => {
        assert(result.metafile, "Core build omitted its input graph")
        writeFileSync(join(output, "metafile.json"), JSON.stringify(result.metafile, null, 2) + "\n")
      })
    },
  }],
})
assert(effectiveOptions)
writeFileSync(join(output, "compiler.json"), JSON.stringify({
  tsup: require("tsup/package.json").version,
  esbuild: require("esbuild/package.json").version,
  sourcePackage: JSON.parse(readFileSync(join(source, "package.json"), "utf8")),
  sourceConfig: readFileSync(join(source, "tsup.config.ts"), "utf8"),
  skipNodeModulesBundle: true,
  qualificationOnlyOverrides: { dts: false, sourcemap: true, outDir: output },
  effectiveOptions,
}, null, 2) + "\n")
