import { expect, test } from "bun:test"
import type { AnyCircuitElement, PcbTrace } from "circuit-json"
import { clonePipeline9TraceForDrc } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/clonePipeline9TraceForDrc"
import { getDrcErrors } from "lib/testing/getDrcErrors"

test("Pipeline9 endpoint-only copies preserve native DRC records without mutating immutable copper", (): void => {
  const signal: PcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "signal",
    source_trace_id: "source-signal",
    route: [-2, -1, 1, 2].map((x): PcbTrace["route"][number] => ({
      route_type: "wire",
      x,
      y: 0,
      width: 0.1,
      layer: "top",
    })),
  }
  const neighbour: PcbTrace = {
    ...signal,
    pcb_trace_id: "neighbour",
    source_trace_id: "source-neighbour",
    route: signal.route.map((point): PcbTrace["route"][number] => {
      if (point.route_type !== "wire") {
        throw new Error("The signal fixture requires wire points")
      }
      return { ...point, y: 0.15 }
    }),
  }
  const multilayer: PcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "multilayer",
    source_trace_id: "source-multilayer",
    route: [
      { route_type: "wire", x: 10, y: -1, width: 0.1, layer: "top" },
      { route_type: "wire", x: 10, y: 0, width: 0.1, layer: "top" },
      {
        route_type: "via",
        x: 10,
        y: 0,
        from_layer: "top",
        to_layer: "bottom",
      },
      { route_type: "wire", x: 10, y: 0, width: 0.1, layer: "bottom" },
      { route_type: "wire", x: 10, y: 1, width: 0.1, layer: "bottom" },
    ],
  }
  const traces = [signal, neighbour, multilayer]
  const snapshot: AnyCircuitElement[] = [
    {
      type: "source_trace",
      source_trace_id: "source-signal",
      connected_source_port_ids: ["source-start", "source-end"],
      connected_source_net_ids: [],
    },
    {
      type: "pcb_port",
      pcb_port_id: "signal-start",
      source_port_id: "source-start",
      x: -2,
      y: 0,
      layers: ["top"],
    },
    {
      type: "pcb_port",
      pcb_port_id: "signal-end",
      source_port_id: "source-end",
      x: 2,
      y: 0,
      layers: ["top"],
    },
    {
      type: "pcb_smtpad",
      pcb_smtpad_id: "foreign-pad",
      pcb_component_id: "foreign-component",
      pcb_port_id: "foreign-port",
      shape: "rect",
      x: 0,
      y: 0.17,
      width: 0.2,
      height: 0.2,
      layer: "top",
    },
    {
      type: "pcb_via",
      pcb_via_id: "foreign-via-a",
      x: 0,
      y: -0.27,
      outer_diameter: 0.3,
      hole_diameter: 0.1,
      layers: ["top", "bottom"],
    },
    {
      type: "pcb_via",
      pcb_via_id: "foreign-via-b",
      x: 0.1,
      y: -0.27,
      outer_diameter: 0.3,
      hole_diameter: 0.1,
      layers: ["top", "bottom"],
    },
    ...traces,
  ]
  const original = structuredClone(snapshot)
  const freezeSnapshot = (value: unknown): void => {
    if (value === null || typeof value !== "object") return
    Object.freeze(value)
    for (const child of Object.values(value)) {
      freezeSnapshot(child)
    }
  }
  freezeSnapshot(snapshot)
  const oldCheckerInput = snapshot.map(
    (element): AnyCircuitElement =>
      element.type === "pcb_trace"
        ? {
            ...element,
            route: element.route.map((point) => ({ ...point })),
          }
        : element,
  )
  const checkerInput = snapshot.map(
    (element): AnyCircuitElement =>
      element.type === "pcb_trace"
        ? clonePipeline9TraceForDrc(element)
        : element,
  )
  const copiedTraces = new Map(
    checkerInput
      .filter((element): element is PcbTrace => element.type === "pcb_trace")
      .map((trace) => [trace.pcb_trace_id, trace]),
  )
  for (const trace of traces) {
    const copied = copiedTraces.get(trace.pcb_trace_id)!
    expect(copied).not.toBe(trace)
    expect(copied.route).not.toBe(trace.route)
    expect(copied).toEqual(trace)
    expect(copied.route[0]).not.toBe(trace.route[0])
    expect(copied.route.at(-1)).not.toBe(trace.route.at(-1))
    for (let index = 1; index < trace.route.length - 1; index++) {
      expect(copied.route[index]).toBe(trace.route[index])
      expect(Object.isFrozen(copied.route[index])).toBeTrue()
    }
  }

  const options = {
    traceClearance: 0.1,
    includeTraceContinuity: false,
    includeBoardEdge: false,
  }
  const expected = getDrcErrors(oldCheckerInput, options)
  const actual = getDrcErrors(checkerInput, options)
  expect(actual).toEqual(expected)
  expect(checkerInput).toEqual(oldCheckerInput)
  for (const type of [
    "pcb_trace_error",
    "pcb_pad_trace_clearance_error",
    "pcb_via_trace_clearance_error",
    "pcb_via_clearance_error",
  ]) {
    expect(actual.errors.some((error) => error.type === type)).toBeTrue()
  }
  const copiedSignal = copiedTraces.get("signal")!
  expect(copiedSignal.route[0]).toMatchObject({
    start_pcb_port_id: "signal-start",
  })
  expect(copiedSignal.route.at(-1)).toMatchObject({
    end_pcb_port_id: "signal-end",
  })
  expect(signal.route[0]).not.toHaveProperty("start_pcb_port_id")
  expect(signal.route.at(-1)).not.toHaveProperty("end_pcb_port_id")
  expect(snapshot).toEqual(original)

  // Official centers and ID arrays must not expose the borrowed interior
  // points or the private snapshot through the result handed to the solver.
  let mutatedCenters = 0
  for (const error of actual.errorsWithCenters) {
    if (!error.center) continue
    for (const trace of traces) {
      for (const point of trace.route) expect(error.center).not.toBe(point)
    }
    error.center.x = 123
    error.center.y = 456
    mutatedCenters++
  }
  expect(mutatedCenters).toBeGreaterThan(0)
  const traceError = actual.errors.find(
    (error) =>
      error.type === "pcb_trace_error" &&
      error.pcb_port_ids?.includes("signal-start"),
  )
  if (!traceError || traceError.type !== "pcb_trace_error") {
    throw new Error("The fixture requires an endpoint-named native trace error")
  }
  traceError.pcb_port_ids!.push("caller-only-port")
  traceError.message = "caller-mutated error"
  expect(snapshot).toEqual(original)
  const repeatedInput = snapshot.map(
    (element): AnyCircuitElement =>
      element.type === "pcb_trace"
        ? clonePipeline9TraceForDrc(element)
        : element,
  )
  expect(getDrcErrors(repeatedInput, options)).toEqual(expected)
  expect(snapshot).toEqual(original)
})
