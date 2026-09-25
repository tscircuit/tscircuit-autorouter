import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"

test("Pipeline9 routes around a preloaded trace terminal section", () => {
  const inputSrj: SimpleRouteJson = {
    bounds: { minX: -10, maxX: 10, minY: -8, maxY: 8 },
    obstacles: [
      {
        circuitJsonMetadata: {
          pcb_smtpad_id: "pcb_smtpad_0",
          pcb_port_id: "pcb_port_0",
          source_port_name: "pin1",
        },
        componentId: "pcb_component_0",
        type: "rect",
        layers: ["top"],
        center: { x: 3, y: 5.35 },
        width: 1.2,
        height: 1.2,
        connectedTo: [
          "pcb_smtpad_0",
          "connectivity_net14",
          "source_trace_0_0",
          "source_trace_0",
          "source_port_0",
          "source_port_1",
          "pcb_port_0",
          "pcb_smtpad_1",
          "connectivity_net14",
          "pcb_port_1",
        ],
      },
      {
        circuitJsonMetadata: {
          pcb_smtpad_id: "pcb_smtpad_1",
          pcb_port_id: "pcb_port_1",
          source_port_name: "pin2",
        },
        componentId: "pcb_component_0",
        type: "rect",
        layers: ["top"],
        center: { x: 3, y: -5.35 },
        width: 1.2,
        height: 1.2,
        connectedTo: [
          "pcb_smtpad_1",
          "source_trace_0_0",
          "source_trace_0",
          "source_port_0",
          "source_port_1",
          "pcb_smtpad_0",
          "pcb_port_0",
          "pcb_port_1",
        ],
      },
      {
        circuitJsonMetadata: {
          pcb_smtpad_id: "pcb_smtpad_2",
          pcb_port_id: "pcb_port_2",
          source_port_name: "pin1",
        },
        componentId: "pcb_component_1",
        type: "rect",
        layers: ["top"],
        center: { x: 0, y: 0 },
        width: 1.2,
        height: 1.2,
        connectedTo: [
          "pcb_smtpad_2",
          "connectivity_net3",
          "source_trace_1",
          "source_port_2",
          "source_port_3",
          "pcb_port_2",
          "pcb_smtpad_3",
          "connectivity_net3",
          "pcb_port_3",
        ],
      },
      {
        circuitJsonMetadata: {
          pcb_smtpad_id: "pcb_smtpad_3",
          pcb_port_id: "pcb_port_3",
          source_port_name: "pin1",
        },
        componentId: "pcb_component_2",
        type: "rect",
        layers: ["top"],
        center: { x: 8, y: 0 },
        width: 1.2,
        height: 1.2,
        connectedTo: [
          "pcb_smtpad_3",
          "source_trace_1",
          "source_port_2",
          "source_port_3",
          "pcb_smtpad_2",
          "pcb_port_2",
          "pcb_port_3",
        ],
      },
    ],
    connections: [
      {
        name: "source_trace_1",
        source_trace_id: "source_trace_1",
        nominalTraceWidth: 0.15,
        width: 0.15,
        pointsToConnect: [
          { x: 8, y: 0, layer: "top", pointId: "pcb_port_3" },
          { x: 0, y: 0, layer: "top", pointId: "pcb_port_2" },
        ],
      },
    ],
    traces: [
      {
        type: "pcb_trace",
        pcb_trace_id: "source_trace_0_0",
        connection_name: "source_trace_0",
        connectsTo: ["pcb_port_0", "pcb_port_1"],
        route: [
          {
            route_type: "wire",
            x: 3,
            y: 5.35,
            width: 0.15,
            layer: "top",
          },
          {
            route_type: "wire",
            x: 3,
            y: -5.35,
            width: 0.15,
            layer: "top",
          },
        ],
      },
    ],
    layerCount: 1,
    minTraceWidth: 0.15,
    minViaDiameter: 0.3,
    minViaHoleDiameter: 0.2,
    minViaPadDiameter: 0.3,
    minTraceToPadEdgeClearance: 0.15,
    minBoardEdgeClearance: 0.2,
  }
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(inputSrj, {
    cacheProvider: null,
  })

  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(solver.getUpdatedPreloadedTraces()[0]!.route[0]).toMatchObject({
    x: 3,
    y: 5.35,
  })
  expect(solver.getUpdatedPreloadedTraces()[0]!.route.at(-1)).toMatchObject({
    x: 3,
    y: -5.35,
  })
  expect(solver.getNewTracesBeforePowerExpansion()).toHaveLength(1)
  expect(solver.getUpdatedPreloadedTraces()).toHaveLength(1)
  expect(
    getBugReportSnapshotSvg({
      inputSrj,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces: solver.getNewTracesBeforePowerExpansion(),
    }),
  ).toMatchSvgSnapshot(import.meta.path)
}, 15_000)
