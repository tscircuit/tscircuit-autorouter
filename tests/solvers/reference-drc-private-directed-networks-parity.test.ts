import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { ConnectivityMap, findConnectedNetworks } from "circuit-json-to-connectivity-map"
import { initializeReferenceDrcRuntime } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/initializeReferenceDrcRuntime"
import { ReferenceDrcPrimitiveMemo } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/ReferenceDrcPrimitiveMemo"
import { findOrderedIndexedConnectedNetworks } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/findOrderedIndexedConnectedNetworks"
import type { ReferenceDrcNativeInternAdmission } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/referenceDrcNativeInternScope"

type Owner = { memo: ReferenceDrcPrimitiveMemo; createPrivatelyMemoizedTraceContinuityChecker(): unknown }
type Scope = { beginReferenceDrcNativeInternScope(memo: unknown, input: unknown): ReferenceDrcNativeInternAdmission | undefined; isReferenceDrcNativeInternScopeActive(memo: unknown): boolean }
type NetworkHelper = { findPrivatelyScopedOrderedConnectedNetworks(memo: unknown, rows: string[][]): Record<string, string[]> | undefined }

test("private directed union preserves Native graph names, deletion, encounter order, aliases and literal decline", async () => {
  await initializeReferenceDrcRuntime()
  const repo = resolve(import.meta.dir, "../.."), work = mkdtempSync(join(tmpdir(), "native-directed-networks-"))
  symlinkSync(join(repo, "node_modules"), join(work, "node_modules"))
  const base = join(repo, "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork")
  const sources = { checker: join(base, "native/lib/check-traces-are-contiguous/check-traces-are-contiguous.ts"), scope: join(base, "referenceDrcNativeInternScope.ts"), helper: join(base, "findPrivatelyScopedOrderedConnectedNetworks.ts") }
  const copies = { checker: join(work, "checker.ts"), scope: join(work, "scope.ts"), helper: join(work, "helper.ts") }
  for (const kind of Object.keys(sources) as (keyof typeof sources)[]) {
    let source = readFileSync(sources[kind], "utf8")
    if (kind === "checker") source = "export let memo: unknown\n" + source.replaceAll("const primitiveMemo = new ReferenceDrcPrimitiveMemo()", "const primitiveMemo = new ReferenceDrcPrimitiveMemo()\n  memo = primitiveMemo")
    source = source.replace(/from\s+"(\.[^"]+)"/g, (_match, spec: string): string => {
      let target = resolve(dirname(sources[kind]), spec)
      if (spec.includes("check-traces-are-contiguous/check-traces-are-contiguous")) target = copies.checker
      else if (spec.endsWith("referenceDrcNativeInternScope")) target = copies.scope
      return `from ${JSON.stringify(target)}`
    })
    writeFileSync(copies[kind], source)
  }
  const owner = await import(copies.checker) as Owner, scope = await import(copies.scope) as Scope, helper = await import(copies.helper) as NetworkHelper
  owner.createPrivatelyMemoizedTraceContinuityChecker()
  const memo = owner.memo
  let events = 0
  const observedRows = new Proxy([], { get() { events++; return undefined }, getPrototypeOf() { events++; return Array.prototype }, getOwnPropertyDescriptor() { events++; return undefined } }) as string[][]
  const ordinary = new ReferenceDrcPrimitiveMemo(), observedMemo = new Proxy(memo, { get() { events++; return undefined }, getPrototypeOf() { events++; return Object.prototype } })
  for (const unowned of [undefined, null, false, "scope", ordinary, observedMemo, {}]) {
    expect(scope.isReferenceDrcNativeInternScopeActive(unowned)).toBe(false)
    expect(helper.findPrivatelyScopedOrderedConnectedNetworks(unowned, observedRows)).toBeUndefined()
  }
  expect(helper.findPrivatelyScopedOrderedConnectedNetworks(memo, observedRows)).toBeUndefined(); expect(events).toBe(0)
  const admission = scope.beginReferenceDrcNativeInternScope(memo, [])
  expect(admission?.kind).toBe("scoped")
  if (admission?.kind !== "scoped") throw new Error("Authentic closed checker scope was not admitted")
  expect(scope.isReferenceDrcNativeInternScopeActive(memo)).toBe(true)
  const fixtures: string[][][] = [[], [[]], [["a"]], [["a", "a"]], [["0", "a"], ["b", "a"]], [["__proto__", "constructor"], ["constructor", "toString"]], [["", "0", "01", "4294967294", "4294967295"], ["__defineGetter__", "hasOwnProperty", "valueOf", "prototype", "length"]], [["a", "b"], ["c", "d"], ["e", "a", "c"], ["b", "f"]]]
  let seed = 11
  const next = (): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed }
  for (let fixture = 0; fixture < 5000; fixture++) {
    const rows: string[][] = []
    for (let i = 0, count = next() % 60; i < count; i++) {
      const row: string[] = []
      for (let j = 0, width = next() % 6; j < width; j++) row.push(String(next() % 31))
      rows.push(row)
    }
    fixtures.push(rows)
  }
  const adversarial: string[][] = [["a", "b"]]
  for (let i = 0; i < 10000; i++) adversarial.push([`via${i}`, "a"])
  fixtures.push(adversarial)
  const memoBefore = { identities: [...(memo as unknown as { identities: Map<string, number> }).identities], nextIdentity: (memo as unknown as { nextIdentity: number }).nextIdentity, diagnostics: { ...memo.diagnostics } }
  try {
    for (const rows of fixtures) {
      const before = structuredClone(rows), native = findConnectedNetworks(rows), indexed = findOrderedIndexedConnectedNetworks(rows)
      const actual = helper.findPrivatelyScopedOrderedConnectedNetworks(memo, rows)
      expect(actual).toEqual(native); expect(actual).toEqual(indexed); expect(rows).toEqual(before)
      if (actual === undefined) throw new Error("Admitted string rows were declined")
      const graph = new ConnectivityMap(actual), original = new ConnectivityMap(native)
      expect(graph).toEqual(original)
      expect(Object.keys(graph.idToNetMap)).toEqual(Object.keys(original.idToNetMap))
      expect(Object.getOwnPropertyDescriptors(graph.idToNetMap)).toEqual(Object.getOwnPropertyDescriptors(original.idToNetMap))
      expect(Object.getPrototypeOf(graph.idToNetMap)).toBe(Object.getPrototypeOf(original.idToNetMap))
      expect(graph.netMap).toBe(actual)
      const arrays = Object.values(actual)
      expect(new Set(arrays).size).toBe(arrays.length)
      for (const members of arrays) expect(rows.some((row) => row === members)).toBe(false)
    }
    for (const id of [undefined, null, 0, -0, 1, NaN, Infinity, false, {}, Symbol("id")]) expect(helper.findPrivatelyScopedOrderedConnectedNetworks(memo, [[id]] as unknown as string[][])).toBeUndefined()
    expect({ identities: [...(memo as unknown as { identities: Map<string, number> }).identities], nextIdentity: (memo as unknown as { nextIdentity: number }).nextIdentity, diagnostics: { ...memo.diagnostics } }).toEqual(memoBefore)
  } finally { admission.finish() }
  expect(scope.isReferenceDrcNativeInternScopeActive(memo)).toBe(false)
  expect(helper.findPrivatelyScopedOrderedConnectedNetworks(memo, observedRows)).toBeUndefined(); expect(events).toBe(0)
  expect(Object.hasOwn(memo, "intern")).toBe(false)
})
