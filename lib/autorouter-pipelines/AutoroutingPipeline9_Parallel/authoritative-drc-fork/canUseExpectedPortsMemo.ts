import * as Flatten from "@flatten-js/core"
import * as CircuitJsonUtil from "@tscircuit/circuit-json-util"
import { all_layers } from "circuit-json"
import * as Connectivity from "circuit-json-to-connectivity-map"
import Flatbush from "flatbush"
import { canUseLazyViaTraceCenters } from "./canUseLazyViaTraceCenters"
import { ReferenceDrcPrimitiveMemo } from "./ReferenceDrcPrimitiveMemo"
import { ScaledConductorPolygonMemo } from "./ScaledConductorPolygonMemo"

const getOwnPropertyNames = Object.getOwnPropertyNames
const getOwnPropertySymbols = Object.getOwnPropertySymbols
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor
const getPrototypeOf = Object.getPrototypeOf
const objectIs = Object.is
const nativeGetTolerance = Flatten.Utils.getTolerance
const nativeTolerance = nativeGetTolerance()
// Fresh default workers use Flatten's pinned 1e-6 numeric tolerance. A public
// setTolerance call before this module loads must retain native memo behavior,
// but its geometry cannot be prepared on workers with a different numeric state.
// The complete checker guard still verifies the live tolerance before either
// preparation site; this immutable admission adds no getter or callback read.
export const referenceDrcWorkerGeometryToleranceIsPinned = objectIs(nativeTolerance, 1e-6)
const additionalGlobals = [
  "WeakMap", "WeakSet", "Proxy", "JSON", "Reflect", "isNaN", "isFinite", "parseInt", "parseFloat",
  "Int8Array", "Uint8Array", "Uint8ClampedArray", "Int16Array", "Uint16Array", "Int32Array", "Uint32Array",
  "Float32Array", "Float64Array", "ArrayBuffer", "SharedArrayBuffer", "DataView",
].map((name) => ({ name, descriptor: getOwnPropertyDescriptor(globalThis, name) }))

type NativeDescriptorSnapshot = {
  target: object
  names: string[]
  symbols: symbol[]
  descriptors: PropertyDescriptor[]
  prototype: object | null
}

// Geometry creation and graph queries precede and separate filter sites. Their
// mutable methods must also stay native: a custom polygon/graph callback could
// otherwise change the retained input after a source's first cached filter.
const nativeSnapshots: NativeDescriptorSnapshot[] = []
const visited = new Set<object>()
const capture = (target: unknown): void => {
  if ((typeof target !== "object" && typeof target !== "function") || target === null || visited.has(target)) return
  if (target === Object.prototype || target === Function.prototype || target === Array.prototype) return
  visited.add(target)
  const names = getOwnPropertyNames(target)
  const symbols = getOwnPropertySymbols(target)
  const descriptors: PropertyDescriptor[] = []
  for (let i = 0; i < names.length; i++) descriptors.push(getOwnPropertyDescriptor(target, names[i]!)!)
  for (let i = 0; i < symbols.length; i++) descriptors.push(getOwnPropertyDescriptor(target, symbols[i]!)!)
  const prototype = getPrototypeOf(target)
  nativeSnapshots.push({ target, names, symbols, descriptors, prototype })
  capture(prototype)
  for (let i = 0; i < descriptors.length; i++) {
    const descriptor = descriptors[i]!
    if ("value" in descriptor) capture(descriptor.value)
  }
}
capture(Flatten)
capture(CircuitJsonUtil)
capture(Connectivity)
capture(Flatbush)
capture(ReferenceDrcPrimitiveMemo)
capture(ScaledConductorPolygonMemo)
capture(all_layers)
capture(WeakMap)
capture(WeakSet)
for (let index = 0; index < additionalGlobals.length; index++) {
  const descriptor = additionalGlobals[index]!.descriptor
  if (descriptor !== undefined && "value" in descriptor) capture(descriptor.value)
}
// Flatten bundles some tree/list classes without public exports. Capture the
// actual prototypes exposed by its own fresh polygon, including PlanarSet's
// interval index, faces, and edges, rather than a different package copy.
capture(new Flatten.Polygon(new Flatten.Circle(new Flatten.Point(0, 0), 1)))
// Its private queue comes from Flatbush's actual dependency instance, including
// installations that do not expose that transitive package at the root.
capture(new Flatbush(1))

/** Called only with a private memo and no supplied physical map. */
export function canUseExpectedPortsMemo(circuitJson: unknown): boolean {
  if (!canUseLazyViaTraceCenters(circuitJson, undefined, undefined)) return false
  for (let index = 0; index < additionalGlobals.length; index++) {
    const snapshot = additionalGlobals[index]!
    const descriptor = getOwnPropertyDescriptor(globalThis, snapshot.name)
    const expected = snapshot.descriptor
    if (expected === undefined) {
      if (descriptor !== undefined) return false
      continue
    }
    if (descriptor === undefined || !objectIs(descriptor.value, expected.value) || descriptor.get !== expected.get || descriptor.set !== expected.set ||
      descriptor.writable !== expected.writable || descriptor.enumerable !== expected.enumerable || descriptor.configurable !== expected.configurable) return false
  }
  for (let index = 0; index < nativeSnapshots.length; index++) {
    const snapshot = nativeSnapshots[index]!
    if (getPrototypeOf(snapshot.target) !== snapshot.prototype) return false
    const names = getOwnPropertyNames(snapshot.target)
    const symbols = getOwnPropertySymbols(snapshot.target)
    if (names.length !== snapshot.names.length || symbols.length !== snapshot.symbols.length) return false
    for (let i = 0; i < snapshot.descriptors.length; i++) {
      const key = i < names.length ? names[i]! : symbols[i - names.length]!
      const expectedKey = i < names.length ? snapshot.names[i]! : snapshot.symbols[i - names.length]!
      if (key !== expectedKey) return false
      const actual = getOwnPropertyDescriptor(snapshot.target, key)
      const expected = snapshot.descriptors[i]!
      if (actual === undefined || !objectIs(actual.value, expected.value) || actual.get !== expected.get || actual.set !== expected.set ||
        actual.writable !== expected.writable || actual.enumerable !== expected.enumerable || actual.configurable !== expected.configurable) return false
    }
  }
  // setTolerance changes Flatten's private numeric state without changing any
  // method descriptor. Read it only after the complete native-method guard.
  return objectIs(nativeGetTolerance(), nativeTolerance)
}
