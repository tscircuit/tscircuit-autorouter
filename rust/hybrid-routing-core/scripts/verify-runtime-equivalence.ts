import { readFileSync } from "node:fs"
import { resolve } from "node:path"

type CoreModule = {
  executeHybridRoutingCore(inputJson: string): string
}

const [nativeModulePath, wasmModulePath] = process.argv.slice(2)
if (!nativeModulePath || !wasmModulePath) {
  throw new Error(
    "usage: bun verify-runtime-equivalence.ts <native-module> <wasm-module>",
  )
}

const nativeModule: CoreModule = require(resolve(nativeModulePath))
const wasmModule: CoreModule = require(resolve(wasmModulePath))
const fixtureDirectory = resolve(import.meta.dir, "../tests/fixtures")

for (const fixtureName of [
  "direct-request.json",
  "obstacle-request.json",
  "ring-activation-request.json",
]) {
  const requestJson = readFileSync(
    resolve(fixtureDirectory, fixtureName),
    "utf8",
  )
  const nativeOutput = nativeModule.executeHybridRoutingCore(requestJson)
  const wasmOutput = wasmModule.executeHybridRoutingCore(requestJson)
  if (nativeOutput !== wasmOutput) {
    throw new Error(`${fixtureName} produced different native and WASM output`)
  }
  console.log(`${fixtureName}: native and WASM outputs are equivalent`)
}
