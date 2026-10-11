import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { ReferenceDrcPrimitiveMemo, type ReferenceDrcPrimitiveMissRow } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/ReferenceDrcPrimitiveMemo"
import { prepareReferenceDrcPrimitiveMissPlan } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/referenceDrcPrimitiveMissPlanning"
import { initializeReferenceDrcRuntime } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/initializeReferenceDrcRuntime"

test("private miss planning preserves exact FIFO snapshots, original consumption and observer decline", async () => {
  await initializeReferenceDrcRuntime()
  const repo = resolve(import.meta.dir, "../.."), dir = mkdtempSync(join(tmpdir(), "reference-miss-plan-"))
  symlinkSync(join(repo, "node_modules"), join(dir, "node_modules"))
  const base = join(repo, "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork")
  const checkerPath = join(base, "native/lib/check-traces-are-contiguous/check-traces-are-contiguous.ts")
  const checkerText = readFileSync(checkerPath, "utf8")
  expect(checkerText.includes("const primitiveMemo = new ReferenceDrcPrimitiveMemo()")).toBe(true)
  const checkerCopy = `export let capturedPrivateMemo: unknown\n` + checkerText.replace("const primitiveMemo = new ReferenceDrcPrimitiveMemo()", "const primitiveMemo = new ReferenceDrcPrimitiveMemo()\n  capturedPrivateMemo = primitiveMemo").replace(/from\s+"(\.[^"]+)"/g, (_match, spec) => `from ${JSON.stringify(resolve(dirname(checkerPath), spec))}`)
  const copiedCheckerPath = join(dir, "native-private-owner.ts")
  writeFileSync(copiedCheckerPath, checkerCopy)
  const helperPath = join(base, "referenceDrcPrimitiveMissPlanning.ts")
  const helperCopy = readFileSync(helperPath, "utf8").replace(/from\s+"(\.[^"]+)"/g, (_match, spec: string) => `from ${JSON.stringify(spec.includes("check-traces-are-contiguous") ? copiedCheckerPath : resolve(base, spec))}`)
  const copiedHelperPath = join(dir, "actual-owner-planner.ts")
  writeFileSync(copiedHelperPath, helperCopy)
  const owner = await import(copiedCheckerPath), planning = await import(copiedHelperPath)
  const makeOwned = (maximumEntries: number): ReferenceDrcPrimitiveMemo => {
    owner.createPrivatelyMemoizedTraceContinuityChecker()
    const memo = owner.capturedPrivateMemo as ReferenceDrcPrimitiveMemo
    Object.defineProperty(memo, "maximumEntries", { value: maximumEntries, writable: true, configurable: true })
    return memo
  }
  const snapshot = (memo: ReferenceDrcPrimitiveMemo): unknown => ({ diagnostics: { ...memo.diagnostics }, values: [...(memo as any).values], identities: [...(memo as any).identities], nextIdentity: (memo as any).nextIdentity })
  for (const maximum of [0, -1, 1, 2, 2.5, 5, 100_000, Infinity, NaN]) {
    const control = new ReferenceDrcPrimitiveMemo(maximum), candidate = makeOwned(maximum)
    const warmed = ["a", "b", "c", "a", "d"]
    for (const value of warmed) { control.getOrCompute("shape", value, () => `warm:${value}`); candidate.getOrCompute("shape", value, () => `warm:${value}`) }
    const cyclic: any = { self: null }; cyclic.self = cyclic
    const inputs: unknown[] = ["a", "b", "x", "x", "c", "a", "y", "b", "x", 0, -0, NaN, Infinity, -Infinity, 1n, undefined, null, { x: 1 }, { x: 1 }, cyclic, cyclic, new Date(0), "z".repeat(200_000)]
    const rows: ReferenceDrcPrimitiveMissRow[] = inputs.map((input, index) => ({ kind: index % 7 === 0 ? "other" : "shape", input }))
    const before = snapshot(candidate)
    const plan = planning.prepareReferenceDrcPrimitiveMissPlan(candidate, rows)
    expect(plan).toBeDefined(); expect(snapshot(candidate)).toEqual(before)
    let nativeComputes = 0, plannedComputes = 0
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex]!
      const native = control.getOrCompute(row.kind, row.input, () => { nativeComputes++; return { computed: rowIndex } })
      const computedBefore = plannedComputes
      const planned = plan.consume(row.kind, row.input, () => { plannedComputes++; return { computed: rowIndex } })
      expect(planned).toEqual(native)
      expect(plan.rows[rowIndex].hit).toBe(plannedComputes === computedBefore)
      expect(snapshot(candidate)).toEqual(snapshot(control))
    }
    plan.finish(); expect(nativeComputes).toBe(plannedComputes)
    expect(() => plan.consume("shape", "extra", () => false)).toThrow("consumed beyond")
  }
  const ordinary = new ReferenceDrcPrimitiveMemo(), rows: ReferenceDrcPrimitiveMissRow[] = [{ kind: "trace-pair", input: [1, 2] }]
  expect(prepareReferenceDrcPrimitiveMissPlan(ordinary, rows)).toBeUndefined()
  expect(planning.prepareReferenceDrcPrimitiveMissPlan(ordinary, rows)).toBeUndefined()
  let traps = 0
  const proxy = new Proxy(ordinary, { get() { traps++; return undefined }, getOwnPropertyDescriptor() { traps++; return undefined }, getPrototypeOf() { traps++; return Object.prototype } })
  expect(planning.prepareReferenceDrcPrimitiveMissPlan(proxy, rows)).toBeUndefined(); expect(traps).toBe(0)
  const memo = makeOwned(2)
  const missing = planning.prepareReferenceDrcPrimitiveMissPlan(memo, rows)
  expect(() => missing.finish()).toThrow("unconsumed")
  memo.getOrCompute("trace-pair", [1, 2], () => true)
  const diagnosticBefore = { ...memo.diagnostics }
  expect(() => missing.consume("trace-pair", [1, 2], () => false)).toThrow("diverged")
  expect(memo.diagnostics).toEqual(diagnosticBefore)
  const changed = planning.prepareReferenceDrcPrimitiveMissPlan(memo, [{ kind: "trace-pair", input: [2, 3] }])
  expect(() => changed.consume("trace-pair", [3, 2], () => false)).toThrow("diverged")
  const throwing = planning.prepareReferenceDrcPrimitiveMissPlan(memo, [{ kind: "trace-pair", input: [5, 6] }])
  const sentinel = new RangeError("native predicate failure")
  const beforeException = snapshot(memo) as any
  let thrown: unknown
  try { throwing.consume("trace-pair", [5, 6], () => { throw sentinel }) } catch (error) { thrown = error }
  expect(thrown).toBe(sentinel); expect(memo.diagnostics.misses).toBe(beforeException.diagnostics.misses + 1)
  expect([...(memo as any).values]).toEqual(beforeException.values)
  let reads = 0
  const accessor = { kind: "shape", input: {} }
  Object.defineProperty(accessor.input, "x", { get() { reads++; return 1 } })
  expect(planning.prepareReferenceDrcPrimitiveMissPlan(memo, [accessor])).toBeUndefined(); expect(reads).toBe(0)
  const observedRows = new Proxy(rows, { getOwnPropertyDescriptor() { traps++; return undefined }, getPrototypeOf() { traps++; return Array.prototype }, get() { traps++; return undefined } })
  expect(planning.prepareReferenceDrcPrimitiveMissPlan(memo, observedRows)).toBeUndefined(); expect(traps).toBe(0)
  const originalStringify = Object.getOwnPropertyDescriptor(JSON, "stringify")!
  Object.defineProperty(JSON, "stringify", { configurable: true, get() { reads++; return originalStringify.value } })
  let decline: unknown
  try { decline = planning.prepareReferenceDrcPrimitiveMissPlan(memo, rows) } finally { Object.defineProperty(JSON, "stringify", originalStringify) }
  expect(decline).toBeUndefined(); expect(reads).toBe(0)
})
