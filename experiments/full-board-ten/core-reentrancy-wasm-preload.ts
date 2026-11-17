import { realpathSync } from "node:fs"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
// Normal published geometry uses Manifold. Routing/unknown WASM stays forbidden.
const wasmUsage = { coldMainImportCalls: 0, coldMainImportStacks: [] as { package: string; stack: string }[], geometryCalls: 0, routingOrUnknownAttempts: 0, geometryStacks: [] as string[] }
let importingPublishedMain = true
const copperModule = fileURLToPath(import.meta.resolve("@tscircuit/copper-pour-solver"))
const geometryModuleOrigins = [...new Set([import.meta.dir, dirname(copperModule)].flatMap(context => ["@tscircuit/manifold-2d", "@tscircuit/manifold-2d/manifold"].flatMap(name => {
  const path = Bun.resolveSync(name, context)
  return [path, realpathSync(path)]
})))]
const guarded = new Set(["Module", "Instance", "Memory", "compile", "instantiate", "compileStreaming", "instantiateStreaming"])
const nativeWasm = globalThis.WebAssembly
const wrappers = new Map<PropertyKey, unknown>()
globalThis.WebAssembly = new Proxy(nativeWasm, {
  get(target, key, receiver): unknown {
    const value = Reflect.get(target, key, receiver)
    if (!guarded.has(String(key))) return value
    if (wrappers.has(key)) return wrappers.get(key)
    const check = (): void => {
      const stack = new Error().stack ?? ""
      if (importingPublishedMain) {
        wasmUsage.coldMainImportCalls++
        if (wasmUsage.coldMainImportStacks.length < 6) wasmUsage.coldMainImportStacks.push({ package: /krt-wasm/.test(stack) ? "@tscircuit/krt-wasm" : geometryModuleOrigins.some(origin => stack.includes(origin)) ? "@tscircuit/manifold-2d" : "unknown published import dependency", stack })
        return
      }
      if (!geometryModuleOrigins.some(origin => stack.includes(origin)) || /krt-wasm|krt_wasm/i.test(stack)) {
        wasmUsage.routingOrUnknownAttempts++
        throw new Error("Routing or unknown WebAssembly is disabled for the full-board cohort")
      }
      wasmUsage.geometryCalls++
      if (wasmUsage.geometryStacks.length < 3) wasmUsage.geometryStacks.push(stack)
    }
    const wrapped = new Proxy(value, {
      apply(fn, thisArg, args): unknown { check(); return Reflect.apply(fn, thisArg, args) },
      construct(fn, args): object { check(); return Reflect.construct(fn, args) },
    })
    wrappers.set(key, wrapped)
    return wrapped
  },
})
globalThis.coreReentrancyWasmPolicy = { beginRouting: () => { importingPublishedMain = false }, usage: wasmUsage }
