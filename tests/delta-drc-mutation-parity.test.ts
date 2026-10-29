import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { AutoroutingDrcEngine } from "high-density-repair03/lib"
import type { SimplifiedPcbTraces } from "high-density-repair03/lib/types"
import { DeltaAutoroutingDrcEngine } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/DeltaAutoroutingDrcEngine"
import { deltaDrcSyntheticBoard, syntheticVia, syntheticWire } from "./fixtures/deltaDrcSynthetic"

test("delta DRC exactly preserves errors through transactional mutations, ownership and order changes", () => {
  const connMap = new ConnectivityMap({})
  connMap.addConnections([["a", "alias_a"], ["b", "alias_b"]])
  const options = { connMap, includeTraceViaOwnerMetadata: true, spatialCellSize: 0.35, traceClearance: 0.12, viaClearance: 0.1, viaToPadClearance: 0.15 }
  const full = new AutoroutingDrcEngine(deltaDrcSyntheticBoard, options)
  const delta = new DeltaAutoroutingDrcEngine(deltaDrcSyntheticBoard, options)
  const current: SimplifiedPcbTraces = [syntheticWire("wire", "a", 0, 0), syntheticVia("via_a", "b", 0.05, 0.08), syntheticVia("via_b", "c", 0.3, 0.1)]
  let checks = 0
  const check = (routes: SimplifiedPcbTraces): void => {
    expect(delta.evaluate(routes)).toEqual(full.evaluate(routes))
    expect(delta.evaluateLegacy(routes)).toEqual(full.evaluateLegacy(routes))
    expect(delta.evaluate(routes)).toEqual(full.evaluate(routes))
    checks += 3
  }
  check([])
  check(current)
  expect(full.evaluate(current).errors.length).toBeGreaterThan(2)
  // Same object changed in place: reference identity cannot be a validity proof.
  const moved = current[0]!.route[0]!
  if (moved.route_type === "jumper") throw new Error("Unexpected synthetic jumper")
  moved.y += 0.07
  check(current)
  current.push(structuredClone(current[1]!))
  current[3]!.pcb_trace_id = "duplicate_via_owner"
  current[3]!.connection_name = "a"
  check(current)
  check([...current].reverse())
  current.splice(1, 1)
  check(current)
  const via = current[1]!.route.find((p) => p.route_type === "via")!
  if (via.route_type !== "via") throw new Error("Synthetic via absent")
  via.via_diameter = 0.45
  via.from_layer = "inner1"
  via.to_layer = "inner2"
  check(current)
  current[0]!.route.splice(1, 0, { ...current[0]!.route[0]! })
  check(current)
  current[0]!.connection_name = "alias_b"
  check(current)
  connMap.addConnections([["b", "c"]])
  check(current)
  check(current.slice(1))
  check([])
  check(current)
  const exposed = delta.evaluate(current)
  if (!exposed.errors[0]) throw new Error("Expected nonempty synthetic errors")
  exposed.errors[0].message = "caller mutation"
  if (exposed.errors[0].center) exposed.errors[0].center.x = 99
  check(current)
  expect(checks).toBe(42)
})
