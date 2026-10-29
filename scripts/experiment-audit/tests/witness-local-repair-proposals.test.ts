import { expect, test } from "bun:test"
import { cloneWithMoves, verifyRawMask, verifyCanonicalMask, wireNormalOffsets, type Move } from "../witness-local-repair-proposals"

test("bounded component proposals protect every unselected raw and canonical field", () => {
  const offsets = wireNormalOffsets({ x: -1, y: 1 }, { x: 1, y: 1 }, { x: 0, y: 0 }, 0.001)
  expect(offsets).toHaveLength(4)
  expect(offsets.every((value) => value.x === 0 && value.y > 0 && Math.hypot(value.x, value.y) <= 0.02)).toBe(true)
  expect(JSON.stringify(wireNormalOffsets({ x: 1, y: 1 }, { x: -1, y: 1 }, { x: 0, y: 0 }, 0.001))).toBe(JSON.stringify(offsets))
  expect(wireNormalOffsets({ x: -1, y: 1 }, { x: 1, y: 1 }, { x: 0, y: 2 }, 0.001).every((value) => value.y < 0)).toBe(true)
  expect(() => wireNormalOffsets({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 }, 0.001)).toThrow()
  expect(() => wireNormalOffsets({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 0 }, 0.001)).toThrow()
  expect(() => wireNormalOffsets({ x: NaN, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 0 }, 0.001)).toThrow()
  const traces = [{ type: "pcb_trace", pcb_trace_id: "t", connection_name: "net", route: [
    { route_type: "wire", x: -2, y: 0, width: 0.1, layer: "top" },
    { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "top" },
    { route_type: "via", x: 0, y: 0, from_layer: "top", to_layer: "bottom" },
    { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "bottom" },
    { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "bottom" },
    { route_type: "wire", x: 2, y: 0, width: 0.1, layer: "bottom" }] }]
  const moves: Move[] = [{ kind: "via", oldXY: { x: 0, y: 0 }, newXY: { x: 0, y: 0.01 }, maximum: 0.25, occurrences: [1, 2, 3].map((pointIndex) => ({ traceIndex: 0, pointIndex })) }]
  const candidate = cloneWithMoves(traces, moves)
  expect(traces[0]!.route[2]!.y).toBe(0)
  expect(verifyRawMask(traces, candidate, moves)).toHaveLength(3)
  const badWidth = structuredClone(candidate);badWidth[0]!.route[1]!.width = 0.2
  expect(() => verifyRawMask(traces, badWidth, moves)).toThrow()
  const badOther = structuredClone(candidate);badOther[0]!.route[4]!.x = 9
  expect(() => verifyRawMask(traces, badOther, moves)).toThrow()
  expect(() => cloneWithMoves(traces, [{ ...moves[0]!, occurrences: [{ traceIndex: 0, pointIndex: 0 }] }])).toThrow()
  expect(() => cloneWithMoves(traces, [{ ...moves[0]!, newXY: { x: 1, y: 0 } }])).toThrow()
  const before = [{ type: "pcb_via", pcb_via_id: "via_0", pcb_trace_id: "t", x: 0, y: 0, outer_diameter: 0.3, hole_diameter: 0.15, layers: ["top", "bottom"] }, { ...traces[0] }]
  const after = [{ ...before[0], y: 0.01 }, { ...candidate[0] }]
  expect(() => verifyCanonicalMask(before, after, traces, candidate, moves)).not.toThrow()
  const badPad = [...after, { type: "pcb_smtpad", x: 0, y: 0 }]
  expect(() => verifyCanonicalMask(before, badPad, traces, candidate, moves)).toThrow()
  const badAlias = structuredClone(after);badAlias[0]!.outer_diameter = 0.4
  expect(() => verifyCanonicalMask(before, badAlias, traces, candidate, moves)).toThrow()
  const badCanonical = structuredClone(after);badCanonical[1]!.route[1]!.y = 0.02
  expect(() => verifyCanonicalMask(before, badCanonical, traces, candidate, moves)).toThrow()
})
