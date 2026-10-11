import { test } from "bun:test"
import { strictEqual } from "node:assert"
import { execFileSync } from "node:child_process"
import { MultiSimplifiedPathSolver } from "@tscircuit/trace-simplification-solver"
import Flatbush from "flatbush"
import {
  captureParallelPathPrototypeContract,
  createParallelPathLookaheadEligibility,
} from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/createParallelPathLookaheadEligibility"
import { ParallelPathQueryCertifier } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelPathQueryCertifier"
import { initializeReferenceDrcRuntime } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/initializeReferenceDrcRuntime"

test("lookahead guards all construction intrinsics and compound inherited metadata observers without invoking them", async (): Promise<void> => {
  await initializeReferenceDrcRuntime()
  const owner = new MultiSimplifiedPathSolver({ unsimplifiedHdRoutes: [{ connectionName: "a", traceThickness: 0.15,
    viaDiameter: 0.3, route: [{ x: 1, y: 1, z: 0 }, { x: 2, y: 2, z: 0 }], vias: [] }],
    obstacles: [{ type: "rect", center: { x: 3, y: 3 }, width: 1, height: 1, layers: ["top"], connectedTo: [] }] })
  const contract = captureParallelPathPrototypeContract(MultiSimplifiedPathSolver.prototype)
  const guard = createParallelPathLookaheadEligibility(owner, contract)!
  strictEqual(guard(), true)
  const control = guard.captureAwaitState()!
  strictEqual(control(), true)
  let calls = 0
  const observer = (): never => { calls++; throw new RangeError("construction observer must remain untouched") }
  const names = ["Float64Array", "Float32Array", "Int8Array", "Uint8Array", "Uint8ClampedArray", "Int16Array", "Uint16Array",
    "Int32Array", "Uint32Array", "BigInt64Array", "BigUint64Array", "ArrayBuffer", "SharedArrayBuffer", "DataView",
    "Promise", "isNaN", "isFinite", "parseInt", "parseFloat", "Number", "URL"]
  for (let index = 0; index < names.length; index++) {
    const name = names[index]!
    const original = Object.getOwnPropertyDescriptor(globalThis, name)
    Object.defineProperty(globalThis, name, { configurable: true, get: observer })
    try {
      strictEqual(guard(), false)
      strictEqual(control(), false)
      strictEqual(createParallelPathLookaheadEligibility(owner, contract), undefined)
      strictEqual(calls, 0)
    } finally {
      if (original) Object.defineProperty(globalThis, name, original)
      else Reflect.deleteProperty(globalThis, name)
    }
    strictEqual(guard(), true)
  }
  const queuePrototype = Object.getPrototypeOf((new Flatbush(1) as unknown as { _queue: object })._queue) as object
  const targets: { target: object; key: PropertyKey }[] = [
    { target: Object.getPrototypeOf(Uint8Array.prototype), key: "set" },
    { target: Uint8Array.prototype, key: "constructor" },
    { target: ArrayBuffer.prototype, key: "slice" },
    { target: DataView.prototype, key: "getFloat64" },
    { target: Promise.prototype, key: "then" },
    { target: Promise, key: "all" },
    { target: queuePrototype, key: "push" },
    { target: queuePrototype, key: "constructor" },
    { target: ParallelPathQueryCertifier.prototype, key: "certify" },
  ]
  for (let index = 0; index < targets.length; index++) {
    const { target, key } = targets[index]!
    const original = Object.getOwnPropertyDescriptor(target, key)!
    Object.defineProperty(target, key, { configurable: true, get: observer })
    try {
      strictEqual(guard(), false)
      strictEqual(control(), false)
      strictEqual(calls, 0)
    } finally { Object.defineProperty(target, key, original) }
    strictEqual(guard(), true)
  }
  // A data-only global replacement must also decline. Native existing-instance
  // continuation does not construct Float64Array, while speculative spans do.
  const originalFloat = Object.getOwnPropertyDescriptor(globalThis, "Float64Array")!
  const originalClass = Float64Array
  Object.defineProperty(globalThis, "Float64Array", { ...originalFloat, value: class extends originalClass {} })
  try { strictEqual(guard(), false) } finally { Object.defineProperty(globalThis, "Float64Array", originalFloat) }
  for (const inheritedKey of ["value", "get", "set", "writable"] as const) {
    const math = Object.getOwnPropertyDescriptor(globalThis, "Math")!
    const inherited = Object.getOwnPropertyDescriptor(Object.prototype, inheritedKey)
    Object.defineProperty(globalThis, "Math", { configurable: true, get: observer })
    Object.defineProperty(Object.prototype, inheritedKey, { configurable: true, get: observer })
    try {
      strictEqual(guard(), false)
      strictEqual(control(), false)
      strictEqual(createParallelPathLookaheadEligibility(owner, contract), undefined)
      strictEqual(calls, 0)
    } finally {
      Reflect.deleteProperty(Object.prototype, inheritedKey)
      if (inherited) Object.defineProperty(Object.prototype, inheritedKey, inherited)
      Object.defineProperty(globalThis, "Math", math)
    }
    strictEqual(guard(), true)
  }
  const continuation = new MultiSimplifiedPathSolver({ unsimplifiedHdRoutes: [{ connectionName: "native", traceThickness: 0.15,
    viaDiameter: 0.3, route: [{ x: 1, y: 1, z: 0 }, { x: 2, y: 2, z: 0 }], vias: [] }],
    obstacles: [{ type: "rect", center: { x: 3, y: 3 }, width: 1, height: 1, layers: ["top"], connectedTo: [] }] })
  Object.defineProperty(globalThis, "Float64Array", { configurable: true, get: observer })
  try {
    continuation.solve()
    strictEqual(continuation.solved, true)
    strictEqual(calls, 0)
  } finally { Object.defineProperty(globalThis, "Float64Array", originalFloat) }
  strictEqual(calls, 0)
  const eligibilityUrl = new URL("../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/createParallelPathLookaheadEligibility.ts", import.meta.url).href
  const runtimeUrl = new URL("../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/initializeReferenceDrcRuntime.ts", import.meta.url).href
  const child = execFileSync(process.execPath, ["-e", `
    Reflect.deleteProperty(globalThis, "SharedArrayBuffer")
    const helper = await import(${JSON.stringify(eligibilityUrl)})
    const runtime = await import(${JSON.stringify(runtimeUrl)})
    const { MultiSimplifiedPathSolver } = await import("@tscircuit/trace-simplification-solver")
    await runtime.initializeReferenceDrcRuntime()
    const owner = new MultiSimplifiedPathSolver({ unsimplifiedHdRoutes: [], obstacles: [] })
    if (helper.createParallelPathLookaheadEligibility(owner, helper.captureParallelPathPrototypeContract(MultiSimplifiedPathSolver.prototype)) !== undefined) throw new Error("SAB-absent runtime must remain native")
    console.log("absent-sab-native")
  `], { encoding: "utf8" })
  strictEqual(child.trim(), "absent-sab-native")
})
