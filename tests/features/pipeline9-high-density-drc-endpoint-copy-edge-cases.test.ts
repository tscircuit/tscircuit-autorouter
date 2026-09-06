import { expect, test } from "bun:test"
import type { AnyCircuitElement, PcbTrace } from "circuit-json"
import { clonePipeline9TraceForDrc } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/clonePipeline9TraceForDrc"
import { getDrcErrors } from "lib/testing/getDrcErrors"

type EndpointCopyCase = {
  name: string
  route: PcbTrace["route"]
  expectedTags: Array<[string | undefined, string | undefined]>
}

test("Pipeline9 endpoint copies preserve native inference for short and aliased route boundaries", (): void => {
  const firstWire: PcbTrace["route"][number] = {
    route_type: "wire",
    x: 0,
    y: 0,
    width: 0.1,
    layer: "top",
  }
  const lastWire: PcbTrace["route"][number] = {
    route_type: "wire",
    x: 1,
    y: 0,
    width: 0.1,
    layer: "top",
  }
  const via: PcbTrace["route"][number] = {
    route_type: "via",
    x: 0,
    y: 0,
    from_layer: "top",
    to_layer: "bottom",
  }
  const throughPad: PcbTrace["route"][number] = {
    route_type: "through_pad",
    start: { x: 2, y: 0 },
    end: { x: 3, y: 0 },
    width: 0.1,
    start_layer: "top",
    end_layer: "bottom",
  }
  const cases: EndpointCopyCase[] = [
    { name: "empty", route: [], expectedTags: [] },
    {
      name: "one-wire",
      route: [firstWire],
      expectedTags: [["port-0", "port-0"]],
    },
    {
      name: "two-wires",
      route: [firstWire, lastWire],
      expectedTags: [
        ["port-0", undefined],
        [undefined, "port-1"],
      ],
    },
    {
      name: "same-object-two-ends",
      route: [firstWire, firstWire],
      expectedTags: [
        ["port-0", undefined],
        [undefined, "port-0"],
      ],
    },
    {
      name: "same-object-ends-and-interior",
      route: [firstWire, firstWire, firstWire],
      expectedTags: [
        ["port-0", undefined],
        [undefined, undefined],
        [undefined, "port-0"],
      ],
    },
    {
      name: "same-object-ends-with-segments",
      route: [firstWire, lastWire, firstWire],
      expectedTags: [
        ["port-0", undefined],
        [undefined, undefined],
        [undefined, "port-0"],
      ],
    },
    {
      name: "one-via",
      route: [via],
      expectedTags: [[undefined, undefined]],
    },
    {
      name: "two-non-wires",
      route: [throughPad, via],
      expectedTags: [
        [undefined, undefined],
        [undefined, undefined],
      ],
    },
    {
      name: "only-last-is-wire",
      route: [via, lastWire],
      expectedTags: [
        [undefined, undefined],
        [undefined, "port-1"],
      ],
    },
    {
      name: "only-first-is-wire",
      route: [firstWire, throughPad],
      expectedTags: [
        ["port-0", undefined],
        [undefined, undefined],
      ],
    },
    {
      name: "non-wire-ends-do-not-promote-interior-wires",
      route: [via, firstWire, lastWire, throughPad],
      expectedTags: [
        [undefined, undefined],
        [undefined, undefined],
        [undefined, undefined],
        [undefined, undefined],
      ],
    },
    {
      name: "existing-interior-tags-and-shared-non-wire-ends",
      route: [
        via,
        { ...firstWire, start_pcb_port_id: "kept-start" },
        { ...lastWire, end_pcb_port_id: "kept-end" },
        via,
      ],
      expectedTags: [
        [undefined, undefined],
        ["kept-start", undefined],
        [undefined, "kept-end"],
        [undefined, undefined],
      ],
    },
  ]
  const metadata: AnyCircuitElement[] = [
    {
      type: "pcb_port",
      pcb_port_id: "port-0",
      source_port_id: "source-port-0",
      x: 0,
      y: 0,
      layers: ["top"],
    },
    {
      type: "pcb_port",
      pcb_port_id: "port-1",
      source_port_id: "source-port-1",
      x: 1,
      y: 0,
      layers: ["top"],
    },
    {
      type: "pcb_smtpad",
      pcb_smtpad_id: "foreign-pad",
      shape: "circle",
      x: 0.5,
      y: 0.25,
      radius: 0.1,
      layer: "top",
    },
  ]
  const options = {
    traceClearance: 0.15,
    includeTraceContinuity: false,
    includeBoardEdge: false,
  }
  let centeredErrorCount = 0
  for (const fixture of cases) {
    const source: PcbTrace = {
      type: "pcb_trace",
      pcb_trace_id: fixture.name,
      route: fixture.route,
    }
    const original = structuredClone(source)
    for (const point of source.route) Object.freeze(point)
    const previousCopy: PcbTrace = {
      ...source,
      route: source.route.map((point) => ({ ...point })),
    }
    const endpointCopy = clonePipeline9TraceForDrc(source)
    expect(endpointCopy).not.toBe(source)
    expect(endpointCopy.route).not.toBe(source.route)
    for (const [index, point] of source.route.entries()) {
      if (index === 0 || index === source.route.length - 1) {
        expect(endpointCopy.route[index]).not.toBe(point)
      } else {
        expect(endpointCopy.route[index]).toBe(point)
      }
    }
    if (source.route.length >= 2) {
      expect(endpointCopy.route[0]).not.toBe(endpointCopy.route.at(-1))
    }
    const expected = getDrcErrors([...metadata, previousCopy], options)
    const actual = getDrcErrors([...metadata, endpointCopy], options)
    expect(actual).toEqual(expected)
    expect(endpointCopy).toEqual(previousCopy)
    expect(
      endpointCopy.route.map((point) => [
        "start_pcb_port_id" in point ? point.start_pcb_port_id : undefined,
        "end_pcb_port_id" in point ? point.end_pcb_port_id : undefined,
      ]),
    ).toEqual(fixture.expectedTags)
    expect(source).toEqual(original)

    // Native centers may describe an interior segment or through-pad extent,
    // but returned mutable locations must not alias the borrowed source data.
    for (const error of actual.errorsWithCenters) {
      if (!error.center) continue
      error.center.x += 100
      error.center.y -= 100
      centeredErrorCount++
    }
    expect(source).toEqual(original)
  }
  expect(centeredErrorCount).toBeGreaterThan(0)
})
