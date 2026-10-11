import * as Flatten from "@flatten-js/core"
import * as CircuitJsonUtil from "@tscircuit/circuit-json-util"
import * as Connectivity from "circuit-json-to-connectivity-map"
import { all_layers } from "circuit-json"
import Flatbush from "flatbush"
import { hasNativeDescriptorMetadata } from "./nativeDescriptorMetadataGuard"

type Snapshot = { target: object; parent: object | null; keys: readonly PropertyKey[]; descriptors: readonly PropertyDescriptor[] }
const descriptor = Object.getOwnPropertyDescriptor, prototype = Object.getPrototypeOf
const keys = Reflect.ownKeys, hasOwn = Object.hasOwn, is = Object.is
const snapshots: Snapshot[] = [], seen = new Set<object>()

function capture(value: unknown): void {
  if (value === null || (typeof value !== "object" && typeof value !== "function") || seen.has(value) ||
    value === Object.prototype || value === Function.prototype || value === Array.prototype) return
  seen.add(value)
  const names = keys(value), descriptors: PropertyDescriptor[] = []
  for (let index = 0; index < names.length; index++) descriptors[index] = descriptor(value, names[index]!)!
  const parent = prototype(value)
  snapshots.push({ target: value, parent, keys: names, descriptors })
  capture(parent)
  for (let index = 0; index < descriptors.length; index++) {
    const own = descriptors[index]!
    if (hasOwn(own, "value")) capture(own.value)
  }
}
// These are the actual dependency instances used by the original terminal
// board validator. Include private Flatten tree/list prototypes exposed by its
// own fresh geometry, not another copy of the interval-tree dependency.
capture(Flatten)
capture(CircuitJsonUtil)
capture(Connectivity)
capture(Flatbush)
capture(all_layers)
capture(new Flatten.Polygon(new Flatten.Circle(new Flatten.Point(0, 0), 1)))
capture(new Flatbush(1))

export function getNativeA13ValidationContractCensus(): { objects: number; descriptors: number } {
  return { objects: snapshots.length, descriptors: snapshots.reduce((sum, snapshot) => sum + snapshot.keys.length, 0) }
}

/** A custom terminal validation callback must decline C before native setup. */
export function hasNativeA13ValidationContract(): boolean {
  if (!hasNativeDescriptorMetadata()) return false
  for (let objectIndex = 0; objectIndex < snapshots.length; objectIndex++) {
    const snapshot = snapshots[objectIndex]!
    if (prototype(snapshot.target) !== snapshot.parent) return false
    const currentKeys = keys(snapshot.target)
    if (currentKeys.length !== snapshot.keys.length) return false
    for (let index = 0; index < currentKeys.length; index++) {
      if (currentKeys[index] !== snapshot.keys[index]) return false
      const current = descriptor(snapshot.target, currentKeys[index]!), original = snapshot.descriptors[index]!
      if (!current || !is(current.value, original.value) || current.get !== original.get || current.set !== original.set ||
        current.writable !== original.writable || current.enumerable !== original.enumerable || current.configurable !== original.configurable) return false
    }
  }
  return true
}
