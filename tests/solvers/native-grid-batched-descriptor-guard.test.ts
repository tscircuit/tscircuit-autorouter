import { expect, test } from "bun:test"
import { HighDensitySolverA01, HighDensitySolverA03 } from "@tscircuit/high-density-a01"
import { installParallelNativeA01Heap } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/installParallelNativeA01Heap"
import { installParallelNativeA03Geometry } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/installParallelNativeA03Geometry"
import { matchesNativeOwnerKernelContract } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/nativeOwnerKernelContract"
import { NativeA01HistoryEquivalence } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/NativeA01HistoryEquivalence"
import { strictEqual } from "node:assert"
import { hasNativeGridKernelIntrinsics } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/nativeGridKernelIntrinsics"
import { hasNativeDescriptorMetadata } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/nativeDescriptorMetadataGuard"
import { NativeA01HeapArena } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/native-a01-heap-arena/NativeA01HeapArena"

const descriptor = Object.getOwnPropertyDescriptor, define = Object.defineProperty
const keys = Reflect.ownKeys, remove = Reflect.deleteProperty
const targets = [Math, Object, Reflect, Array, Map, Set, WeakMap, WeakSet, Number, String, Function,
  Array.prototype, Map.prototype, Set.prototype, Function.prototype, Object.prototype,
  Float64Array.prototype, Uint32Array.prototype, WebAssembly, WebAssembly.Module,
  WebAssembly.Memory.prototype, NativeA01HeapArena, NativeA01HeapArena.prototype]
const metadataNames = ["value", "get", "set", "writable", "enumerable", "configurable"]

test("batched intrinsic guards retain complete property contracts and reject inherited metadata, proxy and reflection observers", (): void => {
  let checked = 0, getterCalls = 0, proxyTraps = 0
  strictEqual(hasNativeGridKernelIntrinsics(undefined, true), true)
  const node = { capacityMeshNodeId: "metadata_guard", center: { x: 0, y: 0 },
    width: 1, height: 1, availableZ: [0], portPoints: [] }
  const a01 = new HighDensitySolverA01({ nodeWithPortPoints: node, cellSizeMm: 0.1, viaDiameter: 0.3 })
  const a03 = new HighDensitySolverA03({ nodeWithPortPoints: node, highResolutionCellSize: 0.1,
    highResolutionCellThickness: 8, lowResolutionCellSize: 0.4, viaDiameter: 0.3 })
  a01.setup(); a03.setup()
  const a01Descriptors = Object.getOwnPropertyDescriptors(HighDensitySolverA01.prototype)
  const a03Descriptors = Object.getOwnPropertyDescriptors(HighDensitySolverA03.prototype)
  const a01Contract = { prototype: HighDensitySolverA01.prototype, descriptors: a01Descriptors }
  const a03Contract = { prototype: HighDensitySolverA03.prototype, descriptors: a03Descriptors }
  for (const target of targets) {
    const names = keys(target)
    for (const name of names) {
      const saved = descriptor(target, name)!
      if (!saved.configurable) continue
      try {
        define(target, name, { __proto__: null, configurable: true, enumerable: saved.enumerable,
          get(): never { getterCalls++; throw new Error("guard invoked a late getter") } } as PropertyDescriptor)
        strictEqual(hasNativeGridKernelIntrinsics(undefined, true), false)
        checked++
      } finally { define(target, name, saved) }
      if ("value" in saved) {
        try {
          define(target, name, { ...saved, value: { changedDescriptor: true } })
          strictEqual(hasNativeGridKernelIntrinsics(undefined, true), false)
          checked++
        } finally { define(target, name, saved) }
      }
    }
    const extra = Symbol("unexpectedIntrinsicProperty")
    try {
      define(target, extra, { configurable: true, value: undefined })
      strictEqual(hasNativeGridKernelIntrinsics(undefined, true), false)
      checked++
    } finally { remove(target, extra) }
  }
  const math = descriptor(globalThis, "Math")!
  try {
    define(globalThis, "Math", { ...math, value: new Proxy(Math, {
      getPrototypeOf(): never { proxyTraps++; throw new Error("guard reflected proxy prototype") },
      ownKeys(): never { proxyTraps++; throw new Error("guard reflected proxy keys") },
      getOwnPropertyDescriptor(): never { proxyTraps++; throw new Error("guard reflected proxy descriptor") },
    }) })
    strictEqual(hasNativeGridKernelIntrinsics(undefined, true), false)
    checked++
  } finally { define(globalThis, "Math", math) }
  for (const name of metadataNames) {
    try {
      define(Object.prototype, name, { __proto__: null, configurable: true,
        get(): never { getterCalls++; throw new Error("inherited metadata observer") } } as PropertyDescriptor)
      strictEqual(hasNativeDescriptorMetadata(), false)
      strictEqual(hasNativeGridKernelIntrinsics(undefined, true), false)
      strictEqual(matchesNativeOwnerKernelContract(a01, a01Contract, HighDensitySolverA01.prototype, a01Descriptors), false)
      strictEqual(NativeA01HistoryEquivalence.capture(a01), null)
      // Direct setup helpers decline before any optional metadata read.
      installParallelNativeA01Heap(a01, a01Contract)
      installParallelNativeA03Geometry(a03, a03Contract)
      checked++
    } finally { remove(Object.prototype, name) }
  }
  // A renamed intrinsic preserves descriptor count but cannot satisfy its key.
  const abs = descriptor(Math, "abs")!
  try {
    remove(Math, "abs")
    define(Math, "unexpectedAbs", abs)
    strictEqual(hasNativeGridKernelIntrinsics(undefined, true), false)
    checked++
  } finally { remove(Math, "unexpectedAbs"); define(Math, "abs", abs) }
  for (const name of metadataNames) {
    const result = Bun.spawnSync([process.execPath, "run", new URL("../fixtures/native-grid-batched-descriptors/preimport.ts", import.meta.url).pathname, name])
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout.toString())).toEqual({ admitted: false, getterCalls: 0 })
  }
  expect(checked).toBeGreaterThan(470)
  expect(getterCalls).toBe(0)
  expect(proxyTraps).toBe(0)
  expect(hasNativeGridKernelIntrinsics(undefined, true)).toBe(true)
})
