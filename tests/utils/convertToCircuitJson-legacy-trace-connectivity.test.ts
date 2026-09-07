import { expect, test } from "bun:test"
import { RELAXED_DRC_OPTIONS } from "lib/testing/drcPresets"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import { getTraceConnectivityIds } from "lib/testing/utils/getTraceConnectivityIds"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"

type LegacyTrace = SimplifiedPcbTrace & { connectedTo?: string[] }

test("preserves legacy fixed trace aliases without overriding canonical connectivity", (): void => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    connections: [],
    obstacles: [
      {
        type: "rect", layers: ["top"], center: { x: -1, y: 0 },
        width: 0.4, height: 0.4,
        connectedTo: ["fixed-net", "port:left"],
        circuitJsonMetadata: {
          pcb_smtpad_id: "pad:left", pcb_port_id: "port:left",
          source_component_name: "U1", source_port_name: "LEFT",
        },
      },
      {
        type: "rect", layers: ["top"], center: { x: 1, y: 0 },
        width: 0.4, height: 0.4,
        connectedTo: ["fixed-net", "port:right"],
        circuitJsonMetadata: {
          pcb_smtpad_id: "pad:right", pcb_port_id: "port:right",
          source_component_name: "U1", source_port_name: "RIGHT",
        },
      },
      {
        type: "rect", layers: ["top"], center: { x: 0, y: 1 },
        width: 0.4, height: 0.4,
        connectedTo: ["foreign-net", "port:foreign"],
        circuitJsonMetadata: {
          pcb_smtpad_id: "pad:foreign", pcb_port_id: "port:foreign",
          source_component_name: "U1", source_port_name: "FOREIGN",
        },
      },
    ],
  }
  const trace: LegacyTrace = {
    type: "pcb_trace", pcb_trace_id: "fixed-trace",
    connection_name: "fixed-net",
    connectedTo: ["fixed-net", "port:left", "port:right"],
    route: [
      { route_type: "wire", x: -1, y: 0, width: 0.1, layer: "top" },
      { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "top" },
    ],
  }
  const inputBefore = JSON.stringify({ srj, trace })
  const circuit = convertToCircuitJson(srj, [trace])
  const sourceTrace = circuit.find(
    (element): boolean => element.type === "source_trace",
  )
  expect(sourceTrace).toMatchObject({
    source_trace_id: "fixed-net",
    connected_source_port_ids: ["port:left", "port:right"],
    connected_source_net_ids: ["fixed-net"],
  })
  expect(getTraceConnectivityIds(trace)).toBe(trace.connectedTo!)
  expect(getDrcErrors(circuit, RELAXED_DRC_OPTIONS).errors).toHaveLength(0)

  const foreignSrj = structuredClone(srj)
  foreignSrj.obstacles[2].center.y = 0
  const foreignCircuit = convertToCircuitJson(foreignSrj, [trace])
  expect(getDrcErrors(foreignCircuit, RELAXED_DRC_OPTIONS).errors).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        error_type: "pcb_trace_error",
        pcb_trace_error_id: "overlap_fixed-trace_pad:foreign",
      }),
    ]),
  )
  expect(foreignCircuit.find(
    (element): boolean => element.type === "source_trace",
  )).toEqual(sourceTrace)

  const disconnectedTrace = structuredClone(trace)
  disconnectedTrace.route[1] = {
    route_type: "wire", x: 0, y: 0, width: 0.1, layer: "top",
  }
  const disconnectedCircuit = convertToCircuitJson(srj, [disconnectedTrace])
  expect(getDrcErrors(disconnectedCircuit, RELAXED_DRC_OPTIONS).errors).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        pcb_trace_error_id: "disconnected_endpoint_fixed-trace_end",
      }),
    ]),
  )

  for (const canonicalIds of [["port:foreign"], []]) {
    const canonicalTrace = { ...trace, connectsTo: canonicalIds }
    expect(getTraceConnectivityIds(canonicalTrace)).toBe(canonicalIds)
    const canonicalCircuit = convertToCircuitJson(srj, [canonicalTrace])
    const withoutLegacy = { ...canonicalTrace }
    delete withoutLegacy.connectedTo
    expect(canonicalCircuit).toEqual(convertToCircuitJson(srj, [withoutLegacy]))
    expect(getDrcErrors(canonicalCircuit, RELAXED_DRC_OPTIONS).errors).toHaveLength(2)
  }

  const withoutMetadata = { ...trace }
  delete withoutMetadata.connectedTo
  expect(getTraceConnectivityIds(withoutMetadata)).toEqual([])
  const noMetadataCircuit = convertToCircuitJson(srj, [withoutMetadata])
  expect(convertToCircuitJson(srj, [trace]).filter(
    (element): boolean => element.type !== "source_trace",
  )).toEqual(
    noMetadataCircuit.filter(
      (element): boolean => element.type !== "source_trace",
    ),
  )
  expect(getDrcErrors(noMetadataCircuit, RELAXED_DRC_OPTIONS).errors).toHaveLength(2)
  expect(JSON.stringify({ srj, trace })).toBe(inputBefore)

  const aliasSrj = structuredClone(srj)
  aliasSrj.connections.push({
    name: "declared-source",
    pointsToConnect: [
      { x: -1, y: 0, layer: "top", pcb_port_id: "port:left" },
      { x: 1, y: 0, layer: "top", pcb_port_id: "port:right" },
    ],
  })
  const aliasTrace: LegacyTrace = {
    ...trace, connection_name: "fixed-section",
    connectedTo: ["declared-source", "port:left", "port:right"],
  }
  const aliasCircuit = convertToCircuitJson(aliasSrj, [aliasTrace])
  expect(aliasCircuit.find(
    (element): boolean => element.type === "pcb_trace",
  )).toMatchObject({ source_trace_id: "declared-source" })
  expect(aliasCircuit.filter(
    (element): boolean => element.type === "source_trace",
  )).toHaveLength(1)
  expect(getDrcErrors(aliasCircuit, RELAXED_DRC_OPTIONS).errors).toHaveLength(0)
})
