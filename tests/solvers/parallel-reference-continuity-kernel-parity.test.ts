import { expect, test } from "bun:test"
import { readFileSync, writeFileSync, mkdtempSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { gunzipSync } from "node:zlib"
import { PcbConnectivityMap } from "circuit-json-to-connectivity-map"
import { getDrcErrors } from "../../lib/testing/getDrcErrors"
import { initializeReferenceDrcRuntime } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/initializeReferenceDrcRuntime"
import { checkViaTraceClearanceWithLazyCenters } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/checkViaTraceClearanceWithLazyCenters"
import { assertParallelReferenceContinuityContext, executeParallelReferenceContinuityBatch, prepareParallelReferenceContinuityContext } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelReferenceContinuityKernel"
import type { ParallelReferenceContinuityTask } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelReferenceContinuityTypes"

test("isolated prepared continuity facts preserve native ordered visits and geometry predicates", async () => {
  await initializeReferenceDrcRuntime()
  const repo = resolve(import.meta.dir, "../..")
  const sourcePath = join(repo, "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/native/lib/check-traces-are-contiguous/check-traces-are-contiguous.ts")
  const work = mkdtempSync(join(tmpdir(), "reference-continuity-oracle-"))
  symlinkSync(join(repo, "node_modules"), join(work, "node_modules"))
  let source = readFileSync(sourcePath, "utf8").replace(/from\s+"(\.[^"]+)"/g, (_match, spec) => `from ${JSON.stringify(resolve(dirname(sourcePath), spec))}`)
  const expression = `      const isConnectedByRoutedSourceTrace = getPhysicallyConnectedTraces(
        trace,
      ).some((candidateTrace) =>
        touchedPortIdsByTraceId
          .get(candidateTrace.pcb_trace_id)
          ?.has(port.pcb_port_id),
      )`
  expect(source.includes(expression)).toBe(true)
  source = `export let portOracle: any = undefined
export function resetPortOracle(): void { portOracle = undefined }
const recordPortOracle = (trace: any, port: any, component: any[], traces: any[], touched: Map<any, Set<any>>, value: boolean, visits: number): void => {
  if (portOracle === undefined) portOracle = { tracePortIds: traces.map((entry) => [...(touched.get(entry.pcb_trace_id) ?? [])]), components: [], rows: [], componentIds: new WeakMap() }
  let componentIndex = portOracle.componentIds.get(component)
  if (componentIndex === undefined) { componentIndex = portOracle.components.length; portOracle.componentIds.set(component, componentIndex); portOracle.components.push(component.map((entry) => traces.indexOf(entry))) }
  portOracle.rows.push({ rowIndex: portOracle.rows.length, componentIndex, portId: port.pcb_port_id, ownerIndex: traces.indexOf(trace), value, visits })
}
` + source.replace(expression, `      const originalComponent = getPhysicallyConnectedTraces(trace)
      let originalVisits = 0
      const isConnectedByRoutedSourceTrace = originalComponent.some((candidateTrace) => {
        originalVisits++
        return touchedPortIdsByTraceId.get(candidateTrace.pcb_trace_id)?.has(port.pcb_port_id)
      })
      recordPortOracle(trace, port, originalComponent, pcbTraces, touchedPortIdsByTraceId, isConnectedByRoutedSourceTrace, originalVisits)`)
  const oraclePath = join(work, "native-oracle.ts")
  writeFileSync(oraclePath, source)
  const oracle = await import(oraclePath)
  const checker = oracle.createPrivatelyMemoizedTraceContinuityChecker()
  const captures = JSON.parse(gunzipSync(new Uint8Array(readFileSync(new URL("../fixtures/reference-drc-srj18/sample015-native-reference.json.gz", import.meta.url)))).toString()) as { records: any[] }
  let totalRows = 0, totalVisits = 0, enabledRecords = 0
  for (const capture of captures.records) {
    oracle.resetPortOracle()
    const result = getDrcErrors(structuredClone(capture.circuitJson), {
      ...capture.options, traceContinuityChecker: checker,
      viaTraceChecker: (circuit, options) => checkViaTraceClearanceWithLazyCenters(circuit, { ...options, enableAxisRejection: true, enableConnectivityMemo: true }),
    })
    expect(JSON.parse(JSON.stringify(result))).toEqual(capture.expected)
    const recorded = oracle.portOracle
    if (recorded === undefined) continue
    enabledRecords++
    const ordinals = new Map<unknown, number>()
    const ordinal = (id: unknown): number => {
      let value = ordinals.get(id)
      if (value === undefined) { value = ordinals.size; ordinals.set(id, value) }
      return value
    }
    const touched = recorded.tracePortIds.map((ids: unknown[]) => ids.map(ordinal))
    const tasks: ParallelReferenceContinuityTask[] = recorded.rows.map((row: any) => ({ kind: "port-connectivity", rowIndex: row.rowIndex, componentIndex: row.componentIndex, portOrdinal: ordinal(row.portId) }))
    const context = prepareParallelReferenceContinuityContext({ snapshotId: capture.number, tracePortOrdinals: touched, components: recorded.components, portCount: ordinals.size })
    const before = structuredClone(context)
    const facts = executeParallelReferenceContinuityBatch({ kind: "referenceContinuityFacts", context, tasks }).facts
    expect(facts.length).toBe(recorded.rows.length)
    for (let i = 0; i < facts.length; i++) {
      const fact = facts[i]!
      expect(fact.status).toBe("evaluated")
      if (fact.status !== "evaluated") throw new Error("Unexpected pure membership exception")
      expect(fact.value).toBe(recorded.rows[i].value)
      expect(facts[i]!.consumedVisits).toBe(recorded.rows[i].visits)
    }
    const interleaved = Array.from({ length: 4 }, (_, lane) => tasks.filter((_, index) => index % 4 === lane))
    const merged = interleaved.flatMap((group) => executeParallelReferenceContinuityBatch({ kind: "referenceContinuityFacts", context, tasks: group }).facts).sort((a, b) => a.rowIndex - b.rowIndex)
    expect(merged).toEqual(facts)
    expect(context).toEqual(before)
    totalRows += facts.length
    totalVisits += facts.reduce((sum, fact) => sum + fact.consumedVisits, 0)
  }
  expect(enabledRecords).toBe(16)
  expect(totalRows).toBe(9024)
  expect(totalVisits).toBeGreaterThan(1_500_000)

  const edge = prepareParallelReferenceContinuityContext({ snapshotId: 18, portCount: 65, tracePortOrdinals: [[0, 31, 32, 64], [32], []], components: [[0, 1, 0, 2], [2], []] })
  const edgeTasks: ParallelReferenceContinuityTask[] = [0, 1, 31, 32, 63, 64].map((port, row) => ({ kind: "port-connectivity", rowIndex: row, componentIndex: 0, portOrdinal: port }))
  edgeTasks.push({ kind: "port-connectivity", rowIndex: 6, componentIndex: 1, portOrdinal: 32 }, { kind: "port-connectivity", rowIndex: 7, componentIndex: 2, portOrdinal: 32 })
  expect(executeParallelReferenceContinuityBatch({ kind: "referenceContinuityFacts", context: edge, tasks: edgeTasks }).facts.map((fact) => [fact.status === "evaluated" ? fact.value : "exception", fact.consumedVisits])).toEqual([[true, 1], [false, 4], [true, 1], [true, 1], [false, 4], [true, 1], [false, 1], [false, 0]])
  const traces: any[] = []
  let seed = 173
  const random = (): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x1_0000_0000 }
  for (let i = 0; i < 96; i++) traces.push({ type: "pcb_trace", pcb_trace_id: `t${i}`, route: Array.from({ length: 2 + i % 5 }, (_, index) => ({ route_type: index === 2 && i % 9 === 0 ? "via" : "wire", x: (random() - 0.5) * 20, y: (random() - 0.5) * 20, width: random(), layer: index % 2 ? "top" : "bottom" })) })
  traces.push({ type: "pcb_trace", pcb_trace_id: "empty", route: [] })
  const geometry = prepareParallelReferenceContinuityContext({ snapshotId: 19, portCount: 0, tracePortOrdinals: [], components: [], geometryTraces: traces })
  const pairs: ParallelReferenceContinuityTask[] = []
  for (let i = 0; i < traces.length; i++) for (let j = 0; j < traces.length; j++) pairs.push({ kind: "native-trace-pair-miss", rowIndex: pairs.length, leftTraceIndex: i, rightTraceIndex: j })
  const nativeMap = new PcbConnectivityMap()
  const results = executeParallelReferenceContinuityBatch({ kind: "referenceContinuityFacts", context: geometry, tasks: pairs }).facts
  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i] as Extract<ParallelReferenceContinuityTask, { kind: "native-trace-pair-miss" }>
    const fact = results[i]!
    expect(fact.status).toBe("evaluated")
    if (fact.status !== "evaluated") throw new Error("Unexpected native pair exception")
    expect(fact.value).toBe(nativeMap._arePcbTracesConnected(traces[pair.leftTraceIndex], traces[pair.rightTraceIndex]))
    expect(results[i]!.consumedVisits).toBe(1)
  }
  const throwingGeometry = prepareParallelReferenceContinuityContext({ snapshotId: 20, portCount: 0, tracePortOrdinals: [], components: [], geometryTraces: [
    { type: "pcb_trace", pcb_trace_id: "invalid", route: [null, null] } as any, traces[0],
  ] })
  const throwingTasks: ParallelReferenceContinuityTask[] = [
    { kind: "native-trace-pair-miss", rowIndex: 0, leftTraceIndex: 0, rightTraceIndex: 1 },
    { kind: "native-trace-pair-miss", rowIndex: 1, leftTraceIndex: 1, rightTraceIndex: 1 },
  ]
  let originalException: any
  try { nativeMap._arePcbTracesConnected(throwingGeometry.geometryTraces![0]!, throwingGeometry.geometryTraces![1]!) } catch (error) { originalException = error }
  const throwingFacts = executeParallelReferenceContinuityBatch({ kind: "referenceContinuityFacts", context: throwingGeometry, tasks: throwingTasks }).facts
  expect(throwingFacts[0]!.status).toBe("exception")
  if (throwingFacts[0]!.status !== "exception") throw new Error("Native geometry exception was hidden")
  expect(throwingFacts[0]!.exception.name).toBe(originalException.name)
  expect(throwingFacts[0]!.exception.message).toBe(originalException.message)
  expect(throwingFacts[1]!.status).toBe("evaluated")
  expect(() => executeParallelReferenceContinuityBatch({ kind: "referenceContinuityFacts", context: throwingGeometry, tasks: [throwingTasks[0]!, { kind: "unknown", rowIndex: 1 } as any] })).toThrow("Unknown pure task kind")

  const invalid: any = { ...edge, componentOffsets: Object.create(Uint32Array.prototype) }
  expect(() => assertParallelReferenceContinuityContext(invalid)).toThrow("Expected Uint32Array")
  expect(() => executeParallelReferenceContinuityBatch({ kind: "unknown", context: edge, tasks: [] } as any)).toThrow("Unknown pure batch kind")
  expect(() => executeParallelReferenceContinuityBatch({ kind: "referenceContinuityFacts", context: edge, tasks: [edgeTasks[0]!, edgeTasks[0]!] })).toThrow("Duplicate task row")
  let getterReads = 0
  const accessor: any = { ...edge }
  Object.defineProperty(accessor, "snapshotId", { configurable: true, get() { getterReads++; return 18 } })
  Object.defineProperty(Object.prototype, "value", { configurable: true, get() { getterReads++; return 18 } })
  try { expect(() => assertParallelReferenceContinuityContext(accessor)).toThrow("Expected own data field snapshotId") }
  finally { delete (Object.prototype as any).value }
  expect(getterReads).toBe(0)
  const shadow = new Uint32Array(edge.componentOffsets)
  Object.defineProperty(shadow, "length", { configurable: true, get() { getterReads++; return 0 } })
  expect(() => assertParallelReferenceContinuityContext({ ...edge, componentOffsets: shadow })).toThrow("shadows native storage")
  expect(getterReads).toBe(0)
  let proxyTraps = 0
  const proxy = new Proxy(edge, { getPrototypeOf() { proxyTraps++; return Object.prototype }, getOwnPropertyDescriptor() { proxyTraps++; return undefined } })
  expect(() => assertParallelReferenceContinuityContext(proxy)).toThrow("Expected non-proxy object")
  expect(proxyTraps).toBe(0)
})
