import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import * as Flatten from "@flatten-js/core"
import { ReferenceDrcPrimitiveMemo } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/ReferenceDrcPrimitiveMemo"
import { initializeReferenceDrcRuntime } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/initializeReferenceDrcRuntime"
import type { ReferenceDrcNativeInternAdmission } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/referenceDrcNativeInternScope"

type MemoState = { identities: Map<string, number>; values: Map<string, unknown>; nextIdentity: number; diagnostics: { hits: number; misses: number } }
type ScopeModule = { beginReferenceDrcNativeInternScope(memo: unknown, input: unknown): ReferenceDrcNativeInternAdmission | undefined; scopeCounts: { calls: number; hits: number; admissions: number; finishes: number } }
type OwnerModule = { capturedPrivateMemo: ReferenceDrcPrimitiveMemo; createPrivatelyMemoizedTraceContinuityChecker(): (input: unknown[]) => unknown; sentinel: Error }

test("only the guarded hidden memo reuses completed intern subkeys and restores every Native transition", async () => {
  await initializeReferenceDrcRuntime()
  const repo = resolve(import.meta.dir, "../.."), work = mkdtempSync(join(tmpdir(), "reference-intern-scope-"))
  symlinkSync(join(repo, "node_modules"), join(work, "node_modules"))
  const base = join(repo, "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork")
  const checkerPath = join(base, "native/lib/check-traces-are-contiguous/check-traces-are-contiguous.ts")
  const scopePath = join(base, "referenceDrcNativeInternScope.ts")
  const rewrite = (source: string, sourcePath: string, checkerCopy: string, scopeCopy: string): string => source.replace(/from\s+"(\.[^"]+)"/g, (_match, spec: string) => {
    const target = spec.includes("check-traces-are-contiguous/check-traces-are-contiguous") ? checkerCopy : spec.endsWith("referenceDrcNativeInternScope") ? scopeCopy : resolve(dirname(sourcePath), spec)
    return `from ${JSON.stringify(target)}`
  })
  const checkerCopy = join(work, "owner.ts"), scopeCopy = join(work, "scope.ts")
  let checkerText = readFileSync(checkerPath, "utf8")
  expect(checkerText.includes("const primitiveMemo = new ReferenceDrcPrimitiveMemo()")).toBe(true)
  checkerText = "export let capturedPrivateMemo: unknown\nexport const sentinel = new RangeError('original Native throw')\n" + checkerText.replaceAll("const primitiveMemo = new ReferenceDrcPrimitiveMemo()", "const primitiveMemo = new ReferenceDrcPrimitiveMemo()\n  capturedPrivateMemo = primitiveMemo")
  writeFileSync(checkerCopy, rewrite(checkerText, checkerPath, checkerCopy, scopeCopy))
  const scopeText = "export const scopeCounts = { calls: 0, hits: 0, admissions: 0, finishes: 0 }\n" + readFileSync(scopePath, "utf8")
    .replace("function internSnapshotKey(value: unknown, visiting: Set<object>, completed: CompletedSubkeys): Snapshot {", "function internSnapshotKey(value: unknown, visiting: Set<object>, completed: CompletedSubkeys): Snapshot {\n  scopeCounts.calls++")
    .replace("if (previous !== undefined) return { key: previous }", "if (previous !== undefined) { scopeCounts.hits++; return { key: previous } }")
    .replace("  defineProperty(memo, \"intern\",", "  scopeCounts.admissions++\n  defineProperty(memo, \"intern\",")
    .replace("      applyNative(activeDelete, activeMemos, [memo])", "      applyNative(activeDelete, activeMemos, [memo])\n      scopeCounts.finishes++")
  writeFileSync(scopeCopy, rewrite(scopeText, scopePath, checkerCopy, scopeCopy))
  const owner = await import(checkerCopy) as OwnerModule, scope = await import(scopeCopy) as ScopeModule
  const makeOwned = (maximumEntries = 100_000): ReferenceDrcPrimitiveMemo => {
    owner.createPrivatelyMemoizedTraceContinuityChecker()
    const memo = owner.capturedPrivateMemo
    Object.defineProperty(memo, "maximumEntries", { value: maximumEntries, writable: true, configurable: true })
    return memo
  }
  const snapshot = (memo: ReferenceDrcPrimitiveMemo): unknown => {
    const fields = memo as unknown as MemoState
    return { diagnostics: { ...fields.diagnostics }, identities: [...fields.identities], values: [...fields.values], nextIdentity: fields.nextIdentity }
  }
  const begin = (memo: ReferenceDrcPrimitiveMemo): Extract<ReferenceDrcNativeInternAdmission, { kind: "scoped" }> => {
    const admission = scope.beginReferenceDrcNativeInternScope(memo, [])
    expect(admission?.kind).toBe("scoped")
    if (admission?.kind !== "scoped") throw new Error("Authentic scope was not admitted")
    return admission
  }
  const ordinary = new ReferenceDrcPrimitiveMemo()
  expect(Object.getOwnPropertyDescriptor(ReferenceDrcPrimitiveMemo.prototype, "beginNativeInternScope")).toBeUndefined()
  expect(scope.beginReferenceDrcNativeInternScope(ordinary, [])).toBeUndefined()
  const mutable = { x: 1 }
  expect(ordinary.intern(mutable)).toBe(1); mutable.x = 2; expect(ordinary.intern(mutable)).toBe(2)
  let traps = 0, reads = 0
  const proxy = new Proxy(ordinary, { get() { traps++; return undefined }, getPrototypeOf() { traps++; return Object.prototype }, getOwnPropertyDescriptor() { traps++; return undefined } })
  expect(scope.beginReferenceDrcNativeInternScope(proxy, [])).toBeUndefined(); expect(traps).toBe(0)
  for (const maximum of [0, -1, 1, 2, 2.5, 5, 100_000, Infinity, NaN]) {
    const native = new ReferenceDrcPrimitiveMemo(maximum), candidate = makeOwned(maximum)
    const point = { x: -0, y: 1 }, other = { y: 1, x: -0 }
    const hidden = Object.defineProperty({ x: 1 }, "hidden", { value: 2, enumerable: false })
    const nullProto = Object.assign(Object.create(null), { x: 1 })
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic
    const array: unknown[] = [point, point]; array.length = 4
    const values: unknown[] = [point, { points: [point, point] }, point, other, hidden, hidden, nullProto, array, array, undefined, null, -0, 0, NaN, Infinity, -Infinity, 3n, cyclic, cyclic, new Date(0), Symbol("uncacheable"), "large".repeat(40_000)]
    const admission = begin(candidate)
    expect(() => scope.beginReferenceDrcNativeInternScope(candidate, [])).toThrow("already active")
    try {
      for (const value of values) {
        expect(candidate.intern(value)).toBe(native.intern(value))
        expect(candidate.getOrCompute("literal", [value], () => candidate.intern(7))).toBe(native.getOrCompute("literal", [value], () => native.intern(7)))
        expect(snapshot(candidate)).toEqual(snapshot(native))
      }
    } finally { admission.finish() }
    expect(Object.hasOwn(candidate, "intern")).toBe(false)
    point.y = 2
    const nextScope = begin(candidate)
    try { expect(candidate.intern(point)).toBe(native.intern(point)); expect(snapshot(candidate)).toEqual(snapshot(native)) } finally { nextScope.finish() }
    expect(Object.hasOwn(candidate, "intern")).toBe(false)
  }
  expect(scope.scopeCounts.hits).toBeGreaterThan(0)
  expect(scope.scopeCounts.admissions).toBe(scope.scopeCounts.finishes)
  const memo = makeOwned(), inputProxy = new Proxy([], { getPrototypeOf() { traps++; return Array.prototype }, getOwnPropertyDescriptor() { traps++; return undefined } })
  expect(scope.beginReferenceDrcNativeInternScope(memo, inputProxy)).toBeUndefined(); expect(traps).toBe(0)
  const accessor = [{ type: "pcb_trace", pcb_trace_id: "a", route: [] }]
  Object.defineProperty(accessor[0], "route", { get() { reads++; return [] } })
  expect(scope.beginReferenceDrcNativeInternScope(memo, accessor)).toBeUndefined(); expect(reads).toBe(0)
  Object.defineProperty(memo, "intern", { configurable: true, get() { reads++; return ReferenceDrcPrimitiveMemo.prototype.intern } })
  expect(scope.beginReferenceDrcNativeInternScope(memo, [])?.kind).toBe("literal"); expect(reads).toBe(0)
  Reflect.deleteProperty(memo, "intern")
  const identities = Object.getOwnPropertyDescriptor(memo, "identities")!
  Object.defineProperty(memo, "identities", { configurable: true, get() { reads++; return identities.value } })
  expect(scope.beginReferenceDrcNativeInternScope(memo, [])?.kind).toBe("literal"); expect(reads).toBe(0)
  Object.defineProperty(memo, "identities", identities)
  Object.defineProperty(memo, "identities", { configurable: true, value: new Proxy(new Map(), { getPrototypeOf() { traps++; return Map.prototype }, get() { traps++; return undefined } }) })
  expect(scope.beginReferenceDrcNativeInternScope(memo, [])?.kind).toBe("literal"); expect(traps).toBe(0)
  Object.defineProperty(memo, "identities", identities)
  const tolerance = Flatten.Utils.getTolerance()
  try { Flatten.Utils.setTolerance(tolerance + 1); expect(scope.beginReferenceDrcNativeInternScope(memo, [])).toBeUndefined() } finally { Flatten.Utils.setTolerance(tolerance) }
  const stringify = Object.getOwnPropertyDescriptor(JSON, "stringify")!
  try {
    Object.defineProperty(JSON, "stringify", { configurable: true, get() { reads++; return stringify.value } })
    expect(scope.beginReferenceDrcNativeInternScope(memo, [])).toBeUndefined()
  } finally { Object.defineProperty(JSON, "stringify", stringify) }
  expect(reads).toBe(0)
  const admission = begin(memo), raw = new RangeError("raw original error")
  let thrown: unknown
  try { try { throw raw } finally { admission.finish() } } catch (error) { thrown = error }
  expect(thrown).toBe(raw); expect(Object.hasOwn(memo, "intern")).toBe(false)
  const throwCheckerCopy = join(work, "throw-owner.ts"), throwScopeCopy = join(work, "throw-scope.ts")
  expect(checkerText.split("  return errors\n").length).toBe(2)
  writeFileSync(throwCheckerCopy, rewrite(checkerText.replace("  return errors\n", "  throw sentinel\n"), checkerPath, throwCheckerCopy, throwScopeCopy))
  writeFileSync(throwScopeCopy, rewrite(scopeText, scopePath, throwCheckerCopy, throwScopeCopy))
  const throwOwner = await import(throwCheckerCopy) as OwnerModule, throwScope = await import(throwScopeCopy) as ScopeModule
  const throwChecker = throwOwner.createPrivatelyMemoizedTraceContinuityChecker()
  try { throwChecker([]) } catch (error) { thrown = error }
  expect(thrown).toBe(throwOwner.sentinel)
  expect(throwScope.scopeCounts.admissions).toBe(1); expect(throwScope.scopeCounts.finishes).toBe(1)
  expect(Object.hasOwn(throwOwner.capturedPrivateMemo, "intern")).toBe(false)
  // Reduced sidecar resource constants exercise saturation without changing
  // the Native memo's own capacity or any intern/FIFO transition.
  const boundedOwnerCopy = join(work, "bounded-owner.ts"), boundedScopeCopy = join(work, "bounded-scope.ts")
  writeFileSync(boundedOwnerCopy, rewrite(checkerText, checkerPath, boundedOwnerCopy, boundedScopeCopy))
  writeFileSync(boundedScopeCopy, rewrite(scopeText.replace("MAX_INTERN_SUBKEYS = 100_000", "MAX_INTERN_SUBKEYS = 2").replace("MAX_INTERN_CHARACTERS = 32_000_000", "MAX_INTERN_CHARACTERS = 64"), scopePath, boundedOwnerCopy, boundedScopeCopy))
  const boundedOwner = await import(boundedOwnerCopy) as OwnerModule, boundedScope = await import(boundedScopeCopy) as ScopeModule
  boundedOwner.createPrivatelyMemoizedTraceContinuityChecker()
  const bounded = boundedOwner.capturedPrivateMemo, literal = new ReferenceDrcPrimitiveMemo()
  const boundedAdmission = boundedScope.beginReferenceDrcNativeInternScope(bounded, [])
  expect(boundedAdmission?.kind).toBe("scoped")
  if (boundedAdmission?.kind !== "scoped") throw new Error("Bounded scope was not admitted")
  const data = [{ x: 1 }, { x: 2 }, { x: 3 }, { large: "a".repeat(1000) }]
  try {
    for (const value of [...data, ...data, ...data]) { expect(bounded.intern(value)).toBe(literal.intern(value)); expect(snapshot(bounded)).toEqual(snapshot(literal)) }
  } finally { boundedAdmission.finish() }
  expect(boundedScope.scopeCounts.hits).toBe(4)
  expect(Object.hasOwn(bounded, "intern")).toBe(false)
})
