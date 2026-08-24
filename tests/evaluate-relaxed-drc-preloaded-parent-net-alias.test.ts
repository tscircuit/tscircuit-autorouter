import { expect, test } from "bun:test"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("relaxed DRC keeps preloaded child copper on its parent net", () => {
  const childTrace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "child_trace_0",
    connection_name: "child_trace",
    connectsTo: ["pcb_port_child", "pcb_port_parent"],
    route: [
      {
        route_type: "wire",
        x: 0,
        y: 0,
        width: 0.1,
        layer: "top",
        start_pcb_port_id: "pcb_port_child",
      },
      {
        route_type: "wire",
        x: 2,
        y: 0,
        width: 0.1,
        layer: "top",
        end_pcb_port_id: "pcb_port_parent",
      },
    ],
  }
  const inputSrj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -1, minY: -1, maxX: 5, maxY: 1 },
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: 0, y: 0 },
        width: 0.5,
        height: 0.5,
        connectedTo: [
          "pcb_smtpad_child",
          "pcb_port_child",
          "pcb_port_parent",
          "child_trace",
          "parent_net",
        ],
        circuitJsonMetadata: {
          pcb_smtpad_id: "pcb_smtpad_child",
          pcb_port_id: "pcb_port_child",
        },
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: 2, y: 0 },
        width: 0.5,
        height: 0.5,
        connectedTo: [
          "pcb_smtpad_parent",
          "pcb_port_child",
          "pcb_port_parent",
          "child_trace",
          "parent_net",
        ],
        circuitJsonMetadata: {
          pcb_smtpad_id: "pcb_smtpad_parent",
          pcb_port_id: "pcb_port_parent",
        },
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: 4, y: 0 },
        width: 0.5,
        height: 0.5,
        connectedTo: ["pcb_smtpad_external", "pcb_port_external", "parent_net"],
        circuitJsonMetadata: {
          pcb_smtpad_id: "pcb_smtpad_external",
          pcb_port_id: "pcb_port_external",
        },
      },
    ],
    connections: [
      {
        name: "parent_net",
        pointsToConnect: [
          { x: 2, y: 0, layer: "top", pcb_port_id: "pcb_port_parent" },
          { x: 4, y: 0, layer: "top", pcb_port_id: "pcb_port_external" },
        ],
      },
    ],
    traces: [childTrace],
  }
  const srjWithPointPairs: SimpleRouteJson = {
    ...inputSrj,
    connections: [
      {
        name: "parent_net_mst0",
        __netConnectionName: "parent_net",
        pointsToConnect: inputSrj.connections[0]!.pointsToConnect,
      },
    ],
  }
  const parentTrace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "parent_trace_0",
    connection_name: "parent_net",
    connectsTo: ["pcb_port_parent", "pcb_port_external"],
    route: [
      {
        route_type: "wire",
        x: 2,
        y: 0,
        width: 0.1,
        layer: "top",
        start_pcb_port_id: "pcb_port_parent",
      },
      {
        route_type: "wire",
        x: 4,
        y: 0,
        width: 0.1,
        layer: "top",
        end_pcb_port_id: "pcb_port_external",
      },
    ],
  }

  const { circuitJson, errors } = evaluateRelaxedDrc({
    inputSrj,
    srjWithPointPairs,
    routedTraces: [parentTrace],
  })
  const childPad = circuitJson.find(
    (element) =>
      element.type === "pcb_smtpad" &&
      element.pcb_smtpad_id === "pcb_smtpad_child",
  )
  const convertedChildTrace = circuitJson.find(
    (element) =>
      element.type === "pcb_trace" &&
      element.pcb_trace_id === childTrace.pcb_trace_id,
  )

  expect(childPad).toMatchObject({ pcb_port_id: "pcb_port_child" })
  expect(convertedChildTrace).toMatchObject({
    source_trace_id: "parent_net",
  })
  expect(errors).toHaveLength(0)
})
