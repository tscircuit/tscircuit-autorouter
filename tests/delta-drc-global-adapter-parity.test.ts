import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { AutoroutingDrcEngine } from "high-density-repair03/lib"
import type { SimplifiedPcbTraces } from "high-density-repair03/lib/types"
import { GlobalDeltaDrcEngine } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/GlobalDeltaDrcEngine"
import { deltaDrcSyntheticBoard, syntheticVia, syntheticWire } from "./fixtures/deltaDrcSynthetic"

test("the native subclass preserves full and legacy findings across local wire and via transactions", () => {
  for (const includeTraceViaOwnerMetadata of [false, true]) {
    const connMap = new ConnectivityMap({})
    connMap.addConnections([["a", "alias_a"]])
    const options = { connMap, includeTraceViaOwnerMetadata, traceClearance: 0.12, viaClearance: 0.1, spatialCellSize: 0.35 }
    const native = new AutoroutingDrcEngine(deltaDrcSyntheticBoard, options)
    const delta = new GlobalDeltaDrcEngine(deltaDrcSyntheticBoard, options)
    const traces: SimplifiedPcbTraces = [
      syntheticWire("wire", "a", 0, 0),
      syntheticVia("via", "b", 0.05, 0.08),
      ...Array.from({ length: 8 }, (_, i) => syntheticWire(`remote_${i}`, `net_${i}`, 5 + i * 2, 4)),
    ]
    expect(delta).toBeInstanceOf(AutoroutingDrcEngine)
    expect(delta.globalStats.globalDeltaDrcActivated).toBeFalse()
    expect(delta.globalStats.nativeConstructorCount).toBe(1)
    const check = (candidate: SimplifiedPcbTraces): void => {
      expect(delta.evaluate(candidate)).toEqual(native.evaluate(candidate))
      expect(delta.evaluateLegacy(candidate)).toEqual(native.evaluateLegacy(candidate))
      expect(delta.lastRunStats).toBeDefined()
    }
    check(traces)
    expect(native.evaluate(traces).errors.length).toBeGreaterThan(0)
    expect(delta.globalStats.deltaDrcChangedCandidateCalls).toBe(0)
    expect(delta.globalStats.deltaDrcChangedCandidateReusedQueries).toBe(0)
    const before = { ...delta.globalStats }
    traces[0]!.route.splice(1, 0, { route_type: "wire", x: 0, y: 0.7, width: 0.1, layer: "top" })
    check(traces)
    expect(delta.globalStats.deltaDrcReusedQueries - before.deltaDrcReusedQueries).toBeGreaterThanOrEqual(16)
    expect(delta.globalStats.deltaDrcChangedCandidateCalls).toBe(1)
    expect(delta.globalStats.deltaDrcChangedCandidateReusedQueries).toBeGreaterThanOrEqual(8)
    const via = traces[1]!.route.find((point) => point.route_type === "via")!
    if (via.route_type !== "via") throw new Error("Synthetic via is absent")
    via.x += 0.1
    via.via_diameter = 0.4
    via.from_layer = "inner1"
    via.to_layer = "inner2"
    check(traces)
    const saved = structuredClone(traces)
    traces[0]!.connection_name = "alias_a"
    traces[1]!.route.splice(2, 1)
    check(traces)
    check([...traces].reverse())
    check(saved)
    check([])
    check(saved)
    expect(delta.globalStats.experimentDeltaDrc).toBeTrue()
    expect(delta.globalStats.stage).toBe("globalDrcForceImproveSolver")
    expect(delta.globalStats.globalDeltaDrcActivated).toBeTrue()
    expect(delta.globalStats.deltaDrcCalls).toBe(16)
    expect(delta.globalStats.deltaDrcTouchedQueries).toBeGreaterThan(0)
    expect(delta.globalStats.deltaDrcReusedQueries).toBeGreaterThan(0)
    expect(Object.values(delta.globalStats).every((value) => ["number", "boolean", "string"].includes(typeof value))).toBeTrue()
  }
  expect(() => new GlobalDeltaDrcEngine(deltaDrcSyntheticBoard, { queryResultCacheBudget: -1 })).toThrow("queryResultCacheBudget")
})
