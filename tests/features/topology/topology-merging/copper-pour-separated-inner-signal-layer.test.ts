import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"

function createSixLayerSandwichedInnerSignalSrj(): SimpleRouteJson {
  return {
    layerCount: 6,
    allowBlindAndBuriedVias: false,
    minTraceWidth: 0.15,
    minViaDiameter: 0.3,
    minViaHoleDiameter: 0.15,
    minTraceToPadEdgeClearance: 0.125,
    minPadEdgeToPadEdgeClearance: 0.15,
    defaultObstacleMargin: 0.125,
    bounds: { minX: 0, maxX: 12, minY: 0, maxY: 12 },
    obstacles: [
      {
        obstacleId: "pour_inner1_gnd",
        type: "rect",
        layers: ["inner1"],
        center: { x: 6, y: 6 },
        width: 12,
        height: 12,
        isCopperPour: true,
        connectedTo: ["gnd"],
      },
      {
        obstacleId: "pour_inner2_bottom",
        type: "rect",
        layers: ["inner2"],
        center: { x: 6, y: 2.75 },
        width: 12,
        height: 5.5,
        isCopperPour: true,
        connectedTo: ["vdd_a"],
      },
      {
        obstacleId: "pour_inner2_top",
        type: "rect",
        layers: ["inner2"],
        center: { x: 6, y: 9 },
        width: 12,
        height: 6,
        isCopperPour: true,
        connectedTo: ["vdd_b"],
      },
      {
        obstacleId: "pour_inner4_pwr",
        type: "rect",
        layers: ["inner4"],
        center: { x: 6, y: 6 },
        width: 12,
        height: 12,
        isCopperPour: true,
        connectedTo: ["vdd"],
      },
      {
        obstacleId: "pad_fixed_0_start",
        type: "rect",
        layers: ["top"],
        center: { x: 1.8, y: 6 },
        width: 0.32,
        height: 0.32,
        connectedTo: ["fixed_net_0", "pcb_port_fixed_0_start"],
        circuitJsonMetadata: {
          pcb_port_id: "pcb_port_fixed_0_start",
          pcb_smtpad_id: "pcb_smtpad_fixed_0_start",
        },
      },
      {
        obstacleId: "pad_fixed_0_end",
        type: "rect",
        layers: ["bottom"],
        center: { x: 2.2, y: 6 },
        width: 0.32,
        height: 0.32,
        connectedTo: ["fixed_net_0", "pcb_port_fixed_0_end"],
        circuitJsonMetadata: {
          pcb_port_id: "pcb_port_fixed_0_end",
          pcb_smtpad_id: "pcb_smtpad_fixed_0_end",
        },
      },
      {
        obstacleId: "pad_h_start",
        type: "rect",
        shape: "circle",
        layers: ["top", "inner1", "inner2", "inner3", "inner4", "bottom"],
        center: { x: 1.5, y: 8 },
        width: 0.5,
        height: 0.5,
        connectedTo: ["sig_horizontal", "pcb_port_h_start"],
      },
      {
        obstacleId: "pad_h_end",
        type: "rect",
        shape: "circle",
        layers: ["top", "inner1", "inner2", "inner3", "inner4", "bottom"],
        center: { x: 10.5, y: 8 },
        width: 0.5,
        height: 0.5,
        connectedTo: ["sig_horizontal", "pcb_port_h_end"],
      },
      {
        obstacleId: "pad_v_start",
        type: "rect",
        shape: "circle",
        layers: ["top", "inner1", "inner2", "inner3", "inner4", "bottom"],
        center: { x: 6, y: 2 },
        width: 0.5,
        height: 0.5,
        connectedTo: ["sig_vertical", "pcb_port_v_start"],
      },
      {
        obstacleId: "pad_v_end",
        type: "rect",
        shape: "circle",
        layers: ["top", "inner1", "inner2", "inner3", "inner4", "bottom"],
        center: { x: 6, y: 10.5 },
        width: 0.5,
        height: 0.5,
        connectedTo: ["sig_vertical", "pcb_port_v_end"],
      },
    ],
    traces: [
      {
        type: "pcb_trace",
        pcb_trace_id: "fixed_dogbone_0",
        connection_name: "fixed_net_0",
        isFixed: true,
        route: [
          {
            route_type: "wire",
            x: 1.8,
            y: 6,
            width: 0.15,
            layer: "top",
            start_pcb_port_id: "pcb_port_fixed_0_start",
          },
          { route_type: "wire", x: 2.2, y: 6, width: 0.15, layer: "top" },
          {
            route_type: "via",
            x: 2.2,
            y: 6,
            from_layer: "top",
            to_layer: "bottom",
            via_diameter: 0.3,
          },
          {
            route_type: "wire",
            x: 2.2,
            y: 6,
            width: 0.15,
            layer: "bottom",
            end_pcb_port_id: "pcb_port_fixed_0_end",
          },
        ],
      },
    ],
    connections: [
      {
        name: "sig_horizontal",
        pointsToConnect: [
          {
            pointId: "pcb_port_h_start",
            pcb_port_id: "pcb_port_h_start",
            x: 1.5,
            y: 8,
            layer: "inner3",
          },
          {
            pointId: "pcb_port_h_end",
            pcb_port_id: "pcb_port_h_end",
            x: 10.5,
            y: 8,
            layer: "inner3",
          },
        ],
      },
      {
        name: "sig_vertical",
        pointsToConnect: [
          {
            pointId: "pcb_port_v_start",
            pcb_port_id: "pcb_port_v_start",
            x: 6,
            y: 2,
            layer: "inner3",
          },
          {
            pointId: "pcb_port_v_end",
            pcb_port_id: "pcb_port_v_end",
            x: 6,
            y: 10.5,
            layer: "inner3",
          },
        ],
      },
    ],
  }
}

test("promotes copper-pour-separated inner signal layers into through-via regions and routes crossings cleanly", (): void => {
  const input = createSixLayerSandwichedInnerSignalSrj()
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(input),
    { cacheProvider: null },
  )
  solver.solve()

  expect(solver.failed, solver.error ?? "").toBe(false)
  expect(solver.solved).toBe(true)

  const globalNodes = solver.topologyPlanningSolver!.getOutput().globalMeshNodes
  const promotedInnerSignalNodes = globalNodes.filter(
    (node) =>
      !node._containsObstacle &&
      node.availableZ.includes(0) &&
      node.availableZ.includes(3) &&
      node.availableZ.includes(5) &&
      !node.availableZ.includes(2),
  )
  expect(promotedInnerSignalNodes.length).toBeGreaterThan(0)

  // Exterior fixed via center (2.2, 6) stays excluded from multi-layer promotion.
  const promotedCoveringFixedVia = promotedInnerSignalNodes.some(
    (node) =>
      2.2 >= node.center.x - node.width / 2 &&
      2.2 <= node.center.x + node.width / 2 &&
      6 >= node.center.y - node.height / 2 &&
      6 <= node.center.y + node.height / 2,
  )
  expect(promotedCoveringFixedVia).toBe(false)

  const routedTraces = solver.getOutputSimplifiedPcbTraces()
  expect(routedTraces).toHaveLength(2)
  const drc = evaluateRelaxedDrc({
    inputSrj: input,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces,
    drcOptions: {
      traceClearance: input.minTraceToPadEdgeClearance,
      viaToPadClearance: input.minViaEdgeToPadEdgeClearance,
      viaClearance: input.minViaHoleEdgeToViaHoleEdgeClearance,
    },
  })
  expect(drc.errors).toEqual([])
})
