import { expect, test } from "bun:test"
import {
  createImmutableCopperCandidateAdmission,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createImmutableCopperCandidateAdmission"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test(
  "repair candidates preserve actual retained copper clearance and inherited geometry",
  (): void => {
    const fixed = { x: -3.2049095622896213, y: 4.117094184051536 }
    const original = { x: -3.492335283076638, y: 3.8177424594363862 }
    const bad = { x: -3.4373754785171715, y: 3.8502746599778206 }
    const viaTrace = (
      id: string,
      net: string,
      point: { x: number; y: number },
    ): SimplifiedPcbTrace => ({
      type: "pcb_trace",
      pcb_trace_id: id,
      connection_name: net,
      route: [
        {
          route_type: "via",
          ...point,
          from_layer: "top",
          to_layer: "bottom",
          via_diameter: 0.3,
          via_hole_diameter: 0.2,
        },
      ],
    })
    const immutable = viaTrace("source_net_28_0", "source_net_28", fixed)
    const initial = viaTrace("source_net_11_mst2_0", "source_net_11", original)
    const rejected = viaTrace(initial.pcb_trace_id, initial.connection_name, bad)
    const srj: SimpleRouteJson = {
      layerCount: 2,
      minTraceWidth: 0.1,
      minViaDiameter: 0.3,
      minViaHoleDiameter: 0.2,
      minTraceToPadEdgeClearance: 0.1,
      minPadEdgeToPadEdgeClearance: 0.1,
      minViaHoleEdgeToViaHoleEdgeClearance: 0.1,
      bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 },
      obstacles: [],
      connections: [],
      traces: [immutable, initial],
    }
    const connMap = getConnectivityMapFromSimpleRouteJson(srj)
    const input = JSON.stringify({ srj, immutable, initial, rejected })
    const admit = createImmutableCopperCandidateAdmission({
      srj,
      connMap,
      initialMovableTraces: [initial],
      immutableTraces: [immutable],
    })
    expect(admit([initial])).toBe(true)
    expect(admit([rejected])).toBe(false)
    const inherited = createImmutableCopperCandidateAdmission({
      srj,
      connMap,
      initialMovableTraces: [rejected],
      immutableTraces: [immutable],
    })
    expect(inherited([rejected])).toBe(true)
    expect(inherited([initial])).toBe(true)
    expect(
      inherited([
        viaTrace(initial.pcb_trace_id, initial.connection_name, {
          x: (fixed.x + bad.x) / 2,
          y: (fixed.y + bad.y) / 2,
        }),
      ]),
    ).toBe(false)
    expect(
      admit([viaTrace(initial.pcb_trace_id, immutable.connection_name, bad)]),
    ).toBe(true)
    const fullSpan: SimpleRouteJson = { ...srj, layerCount: 4 }
    const inner = {
      ...rejected,
      route: [
        {
          ...rejected.route[0]!,
          from_layer: "inner1",
          to_layer: "inner2",
        } as typeof rejected.route[number],
      ],
    }
    expect(
      createImmutableCopperCandidateAdmission({
        srj: fullSpan,
        connMap,
        initialMovableTraces: [],
        immutableTraces: [immutable],
      })([inner]),
    ).toBe(false)
    const blind = { ...fullSpan, allowBlindAndBuriedVias: true }
    const shortBarrel = {
      ...immutable,
      route: [
        {
          ...immutable.route[0]!,
          from_layer: "top",
          to_layer: "inner1",
        } as typeof immutable.route[number],
      ],
    }
    const separateBarrel = {
      ...rejected,
      route: [
        {
          ...rejected.route[0]!,
          from_layer: "inner2",
          to_layer: "bottom",
        } as typeof rejected.route[number],
      ],
    }
    expect(
      createImmutableCopperCandidateAdmission({
        srj: blind,
        connMap,
        initialMovableTraces: [],
        immutableTraces: [shortBarrel],
      })([separateBarrel]),
    ).toBe(true)
    const sameWire: SimplifiedPcbTrace = {
      ...initial,
      route: [
        { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "top" },
        { route_type: "wire", x: 1, y: 0, width: 1, layer: "top" },
      ],
    }
    const nearbyWire: SimplifiedPcbTrace = {
      ...immutable,
      route: [
        { route_type: "wire", x: 0, y: 0.25, width: 0.1, layer: "top" },
        { route_type: "wire", x: 1, y: 0.25, width: 0.1, layer: "top" },
      ],
    }
    expect(
      createImmutableCopperCandidateAdmission({
        srj,
        connMap,
        initialMovableTraces: [],
        immutableTraces: [nearbyWire],
      })([sameWire]),
    ).toBe(true)
    const fixedHole = viaTrace(immutable.pcb_trace_id, immutable.connection_name, { x: 0, y: 0 })
    const initialHole = viaTrace(initial.pcb_trace_id, initial.connection_name, { x: 0.31, y: 0 })
    initialHole.route = [
      {
        ...initialHole.route[0]!,
        via_hole_diameter: 0.1,
      } as typeof initialHole.route[number],
    ]
    const newHoleConflict = viaTrace(initial.pcb_trace_id, initial.connection_name, { x: 0.335, y: 0 })
    newHoleConflict.route = [
      {
        ...newHoleConflict.route[0]!,
        via_hole_diameter: 0.29,
      } as typeof newHoleConflict.route[number],
    ]
    expect(
      createImmutableCopperCandidateAdmission({
        srj,
        connMap,
        initialMovableTraces: [initialHole],
        immutableTraces: [fixedHole],
      })([newHoleConflict]),
    ).toBe(false)
    const dirtyWire: SimplifiedPcbTrace = {
      ...initial,
      route: [
        { route_type: "wire", x: -1, y: 0.25, width: 0.1, layer: "top" },
        { route_type: "wire", x: 1, y: 0.25, width: 0.1, layer: "top" },
        { route_type: "wire", x: -1, y: 1, width: 0.1, layer: "bottom" },
        { route_type: "wire", x: 1, y: 1, width: 0.1, layer: "bottom" },
      ],
    }
    const newPrimitiveConflict: SimplifiedPcbTrace = {
      ...dirtyWire,
      route: dirtyWire.route.map((point, index) =>
        index >= 2 ? { ...point, y: 0.275 } : point,
      ),
    }
    const admitDirtyWire = createImmutableCopperCandidateAdmission({
      srj,
      connMap,
      initialMovableTraces: [dirtyWire],
      immutableTraces: [fixedHole],
    })
    expect(admitDirtyWire([dirtyWire])).toBe(true)
    expect(admitDirtyWire([newPrimitiveConflict])).toBe(false)
    const unmatchedDirtyTopology: SimplifiedPcbTrace = {
      ...dirtyWire,
      route: [
        ...dirtyWire.route.slice(0, 1),
        { route_type: "wire", x: 0, y: 0.25, width: 0.1, layer: "top" },
        ...dirtyWire.route.slice(1),
      ],
    }
    expect(admitDirtyWire([unmatchedDirtyTopology])).toBe(false)
    expect(JSON.stringify({ srj, immutable, initial, rejected })).toBe(input)
  },
)
