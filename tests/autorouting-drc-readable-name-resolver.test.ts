import { expect, test } from "bun:test"
import { getPrimaryId } from "@tscircuit/circuit-json-util"
import type { AnyCircuitElement } from "circuit-json"
import {
  createDrcReadableNameResolver,
  getDrcReadableElementName,
  getDrcReadablePortName,
  getDrcReadableSourceTraceName,
  getDrcReadableTraceName,
} from "lib/utils/autorouting-drc/drcReadableNames"

test("evaluation name indexes preserve first matches and refresh after circuit edits", () => {
  const circuit = [
    {
      type: "source_component",
      source_component_id: "source_component_a",
      name: "U1",
      ftype: "simple_chip",
    },
    {
      type: "source_component",
      source_component_id: "source_component_a",
      name: "wrong component",
      ftype: "simple_chip",
    },
    {
      type: "source_component",
      source_component_id: "source_component_b",
      name: "J2",
      ftype: "simple_chip",
    },
    {
      type: "source_port",
      source_port_id: "source_port_a",
      source_component_id: "source_component_a",
      name: "SDA",
    },
    {
      type: "source_port",
      source_port_id: "source_port_a",
      source_component_id: "source_component_b",
      name: "wrong port",
    },
    {
      type: "source_port",
      source_port_id: "source_port_b",
      source_component_id: "source_component_b",
      pin_number: 2,
    },
    {
      type: "pcb_port",
      pcb_port_id: "pcb_port_a",
      source_port_id: "source_port_a",
      x: 0,
      y: 0,
      layers: ["top"],
    },
    {
      type: "pcb_port",
      pcb_port_id: "pcb_port_a",
      source_port_id: "source_port_unrelated",
      x: 1,
      y: 0,
      layers: ["top"],
    },
    {
      type: "pcb_port",
      pcb_port_id: "pcb_port_alias",
      source_port_id: "source_port_a",
      x: 0,
      y: 0,
      layers: ["top"],
    },
    {
      type: "source_trace",
      source_trace_id: "source_trace_a",
      connected_source_port_ids: ["source_port_a", "source_port_b"],
    },
    {
      type: "source_trace",
      source_trace_id: "source_trace_a",
      display_name: "wrong trace",
      connected_source_port_ids: [],
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "pcb_trace_a",
      source_trace_id: "source_trace_a",
      route: [],
    },
    { type: "pcb_trace", pcb_trace_id: "pcb_trace_a", route: [] },
    {
      type: "pcb_smtpad",
      pcb_smtpad_id: "pcb_smtpad_a",
      pcb_port_id: "pcb_port_a",
      shape: "rect",
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      layer: "top",
    },
    {
      type: "pcb_smtpad",
      pcb_smtpad_id: "pcb_smtpad_a",
      shape: "circle",
      x: 0,
      y: 0,
      radius: 1,
      layer: "top",
    },
    {
      type: "pcb_component",
      pcb_component_id: "pcb_component_a",
      source_component_id: "source_component_a",
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      rotation: 0,
      layer: "top",
    },
    {
      type: "pcb_via",
      pcb_via_id: "pcb_via_a",
      x: 0,
      y: 0,
      outer_diameter: 0.3,
      hole_diameter: 0.15,
      layers: ["top", "bottom"],
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "pcb_trace_endpoint",
      route: [
        {
          route_type: "wire",
          x: 0,
          y: 0,
          width: 0.1,
          layer: "top",
          start_pcb_port_id: "pcb_port_a",
        },
        {
          route_type: "wire",
          x: 1,
          y: 0,
          width: 0.1,
          layer: "top",
          end_pcb_port_id: "pcb_port_alias",
        },
      ],
    },
  ] as AnyCircuitElement[]

  for (const opaque of [false, true]) {
    const ids = new Map<string, string>()
    for (const element of circuit) {
      const id = getPrimaryId(element)
      if (id && !ids.has(id)) ids.set(id, `n${ids.size}`)
    }
    const input: AnyCircuitElement[] = JSON.parse(
      JSON.stringify(circuit, (_key, value) =>
        opaque && typeof value === "string" ? (ids.get(value) ?? value) : value,
      ),
    )
    const id = (original: string): string =>
      opaque ? ids.get(original)! : original
    for (const renamed of [false, true]) {
      if (renamed) {
        const component = input.find(
          (element) => element.type === "source_component",
        )!
        if (component.type !== "source_component")
          throw new Error("Missing source component")
        component.name = "U9"
      }
      const resolver = createDrcReadableNameResolver(input)
      const expectedPort = renamed ? "U9.SDA" : "U1.SDA"
      expect(resolver.getPortName(id("pcb_port_a"))).toBe(expectedPort)
      expect(resolver.getTraceName(id("pcb_trace_a"))).toBe(
        `${expectedPort} to J2.2`,
      )
      expect(resolver.getElementName(id("pcb_smtpad_a"))).toBe(expectedPort)
      for (let repeat = 0; repeat < 2; repeat++) {
        for (const element of input) {
          const elementId = getPrimaryId(element)
          if (elementId) {
            expect(resolver.getElementName(elementId)).toBe(
              getDrcReadableElementName(input, elementId),
            )
          }
          if (element.type === "pcb_port")
            expect(resolver.getPortName(element.pcb_port_id)).toBe(
              getDrcReadablePortName(input, element.pcb_port_id),
            )
          if (element.type === "pcb_trace")
            expect(resolver.getTraceName(element.pcb_trace_id)).toBe(
              getDrcReadableTraceName(input, element.pcb_trace_id),
            )
          if (element.type === "source_trace")
            expect(resolver.getSourceTraceName(element)).toBe(
              getDrcReadableSourceTraceName(input, element),
            )
        }
      }
      expect(resolver.getPortName("absent")).toBe("unnamed port")
      expect(resolver.getTraceName("absent")).toBe("unnamed trace")
      expect(resolver.getElementName("absent")).toBe("unnamed element")
    }
  }
})
