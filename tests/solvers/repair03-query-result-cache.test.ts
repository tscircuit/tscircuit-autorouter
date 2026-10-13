import { expect, spyOn, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { AutoroutingDrcEngine } from "high-density-repair03/lib/drc/AutoroutingDrcEngine"
import type {
  SimpleRouteJson,
  SimplifiedPcbTrace,
} from "high-density-repair03/lib/types"

type WirePoint = Extract<
  SimplifiedPcbTrace["route"][number],
  { route_type: "wire" }
>
type ViaPoint = Extract<
  SimplifiedPcbTrace["route"][number],
  { route_type: "via" }
>
type CacheInternals = {
  checkTracePair: (...args: unknown[]) => unknown
  queryResultCache: Map<string, unknown>
  queryResultUnits: number
  primitiveKeyUnits: number
  primitiveIdsByKey: Map<string, number>
  getPrimitiveId: (values: unknown[]) => number
}

test("DRC query result cache preserves ordered results and logical stats across input changes", (): void => {
  const srj: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    bounds: { minX: -5, minY: -5, maxX: 5, maxY: 5 },
    connections: [],
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: 0, y: 0 },
        width: 0.3,
        height: 0.3,
        ccwRotationDegrees: 17,
        connectedTo: ["pcb_smtpad_1"],
      },
      {
        type: "rect",
        layers: ["top", "bottom"],
        center: { x: 0.6, y: 0.3 },
        width: 0.3,
        height: 0.3,
        connectedTo: ["pcb_plated_hole_1"],
      },
    ],
  }
  const traces: SimplifiedPcbTrace[] = [
    {
      type: "pcb_trace",
      pcb_trace_id: "trace_a",
      connection_name: "a",
      route: [
        {
          route_type: "wire",
          x: -2,
          y: 0.25,
          width: 0.2,
          layer: "top",
          start_pcb_port_id: "port_a",
        },
        { route_type: "wire", x: 2, y: 0.25, width: 0.2, layer: "top" },
        {
          route_type: "via",
          x: 0.2,
          y: 0.25,
          from_layer: "top",
          to_layer: "bottom",
          via_diameter: 0.3,
        },
      ],
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "trace_b",
      connection_name: "b",
      route: [
        { route_type: "wire", x: 0.15, y: -2, width: 0.2, layer: "top" },
        {
          route_type: "wire",
          x: 0.15,
          y: 2,
          width: 0.2,
          layer: "top",
          end_pcb_port_id: "port_b",
        },
        {
          route_type: "via",
          x: 0.4,
          y: 0.25,
          from_layer: "top",
          to_layer: "bottom",
          via_diameter: 0.4,
        },
      ],
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "trace_alias_a",
      connection_name: "alias_a",
      route: [
        { route_type: "wire", x: -1, y: 0.3, width: 0.2, layer: "top" },
        { route_type: "wire", x: 1, y: 0.3, width: 0.2, layer: "top" },
      ],
    },
  ]
  const connMap = new ConnectivityMap({
    net_a: ["a", "alias_a"],
    net_b: ["b"],
    net_pad: ["pcb_smtpad_1"],
    net_hole: ["pcb_plated_hole_1"],
  })
  const options = {
    connMap,
    traceClearance: 0.15,
    viaClearance: 0.15,
    includeTraceViaOwnerMetadata: true,
  }
  const cached = new AutoroutingDrcEngine(srj, options)
  const reference = new AutoroutingDrcEngine(srj, {
    ...options,
    queryResultCacheBudget: 0,
  })
  const internals = cached as unknown as CacheInternals
  const tracePairChecks = spyOn(internals, "checkTracePair")
  const check = (): ReturnType<AutoroutingDrcEngine["evaluate"]> => {
    const expected = reference.evaluate(traces)
    const result = cached.evaluate(traces)
    expect(result).toEqual(expected)
    expect(cached.lastRunStats).toEqual(reference.lastRunStats)
    expect(cached.evaluateLegacy(traces)).toEqual(
      reference.evaluateLegacy(traces),
    )
    expect(cached.lastRunStats).toEqual(reference.lastRunStats)
    return result
  }

  try {
    const first = check()
    expect(first.errors.length).toBeGreaterThan(0)
    const firstCheckCount = tracePairChecks.mock.calls.length
    check()
    expect(tracePairChecks.mock.calls.length).toBe(firstCheckCount)
    first.errors[0]!.message = "caller mutation"
    first.errors[0]!.center!.x = 999
    const portIds = first.errors[0]!.pcb_port_ids as string[] | undefined
    portIds?.push("caller mutation")
    check()

    const wire = traces[0]!.route[0] as WirePoint
    const end = traces[0]!.route[1] as WirePoint
    const via = traces[0]!.route[2] as ViaPoint
    const changes: Array<() => void> = [
      () => {
        wire.x += 0.1
      },
      () => {
        wire.y += 0.02
      },
      () => {
        end.x -= 0.1
      },
      () => {
        end.y += 0.01
      },
      () => {
        wire.width = 0.3
      },
      () => {
        wire.start_pcb_port_id = "new_port"
        end.end_pcb_port_id = "other_port"
      },
      () => {
        wire.layer = "bottom"
        end.layer = "bottom"
      },
      () => {
        wire.layer = "top"
        end.layer = "top"
      },
      () => {
        traces[1]!.pcb_trace_id = "renamed_trace"
      },
      () => {
        traces[1]!.connection_name = "a"
      },
      () => {
        traces[1]!.connection_name = "b"
      },
      () => {
        via.x += 0.05
      },
      () => {
        via.y += 0.05
      },
      () => {
        via.via_diameter = 0.8
      },
      () => {
        srj.allowBlindAndBuriedVias = true
        via.to_layer = "inner1"
      },
      () => {
        traces.reverse()
      },
      () => {
        const added = structuredClone(traces[0]!)
        added.pcb_trace_id = "inserted_trace"
        added.connection_name = "inserted_net"
        traces.splice(1, 0, added)
      },
      () => {
        traces.splice(1, 1)
      },
      () => {
        srj.obstacles[1]!.connectedTo.push("a")
      },
      () => {
        srj.obstacles[1]!.connectedTo.splice(1, 1)
      },
      () => {
        connMap.addConnections([["a", "pcb_smtpad_1"]])
      },
      () => {
        connMap.addConnections([["a", "b"]])
      },
    ]
    for (const change of changes) {
      change()
      check()
      check()
    }

    const disabled = new AutoroutingDrcEngine(srj, {
      ...options,
      queryResultCacheBudget: 0,
    })
    expect(disabled.evaluate(traces)).toEqual(reference.evaluate(traces))
    expect(disabled.lastRunStats).toEqual(reference.lastRunStats)
    expect((disabled as unknown as CacheInternals).queryResultUnits).toBe(0)
    expect((disabled as unknown as CacheInternals).primitiveKeyUnits).toBe(0)

    for (const traceClearance of [0, 0.05, 0.5]) {
      const context = {
        ...options,
        traceClearance,
        viaClearance: traceClearance,
      }
      const isolated = new AutoroutingDrcEngine(srj, context)
      const uncached = new AutoroutingDrcEngine(srj, {
        ...context,
        queryResultCacheBudget: 0,
      })
      expect(isolated.evaluate(traces)).toEqual(uncached.evaluate(traces))
      expect(isolated.evaluate(traces)).toEqual(uncached.evaluate(traces))
    }

    const bounded = new AutoroutingDrcEngine(srj, {
      ...options,
      queryResultCacheBudget: 1_024,
    })
    const boundedInternals = bounded as unknown as CacheInternals
    for (let index = 0; index < 8; index++) {
      wire.y += 0.001
      expect(bounded.evaluate(traces)).toEqual(reference.evaluate(traces))
      expect(
        boundedInternals.queryResultUnits + boundedInternals.primitiveKeyUnits,
      ).toBeLessThanOrEqual(1_024)
    }
    for (const capacity of [-1, 0.5, Infinity, NaN]) {
      expect(
        () =>
          new AutoroutingDrcEngine(srj, { queryResultCacheBudget: capacity }),
      ).toThrow("queryResultCacheBudget")
    }
    const specialValues = [0, -0, NaN, Infinity, -Infinity, null]
    const specialPrimitiveIds = specialValues.map((value) =>
      internals.getPrimitiveId([value]),
    )
    expect(new Set(specialPrimitiveIds).size).toBe(specialValues.length)
    for (let index = 0; index < specialValues.length; index++) {
      expect(internals.getPrimitiveId([specialValues[index]])).toBe(
        specialPrimitiveIds[index],
      )
    }
  } finally {
    tracePairChecks.mockRestore()
  }
})
