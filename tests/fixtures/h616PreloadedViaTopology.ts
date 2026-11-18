import type { PcbSilkscreenText } from "circuit-json"
import type { Obstacle, SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

// Native H616 RAM, its two ZQ resistors, nearby supply pads and retained routes.
// Keep the native coordinates: rounding them changes coarse port selection.
type PadTuple = [
  portId: number,
  padId: number,
  componentId: number,
  x: number,
  y: number,
  width: number,
  height: number,
  layer: string,
  netId: number | null,
  circle: boolean,
]

const peripheralPadTuples: PadTuple[] = [
  [7, 7, 3, 0.3950000000000057, 10.709999999999994, 0.735, 0.62, "bottom", 2, false],
  [44, 44, 22, -4.175000000000016, 8.11999999999999, 0.735, 0.62, "bottom", 1, false],
  [45, 45, 22, -3.040000000000016, 8.11999999999999, 0.735, 0.62, "bottom", 2, false],
  [
    132, 132, 66, -0.6299999999999955, 9.95499999999999,
    0.62, 0.735, "bottom", 12, false,
  ],
  [
    133, 133, 66, -0.6299999999999955, 8.819999999999988,
    0.62, 0.735, "bottom", 13, false,
  ],
  [
    251, 243, 101, -5.515000000000011, 11.439999999999998,
    0.715, 0.64, "bottom", 12, false,
  ],
  [
    252, 244, 101, -6.7100000000000115, 11.439999999999998,
    0.715, 0.64, "bottom", 13, false,
  ],
  [
    253, 245, 102, -5.650000000000002, 8.009999999999991,
    0.715, 0.64, "bottom", 115, false,
  ],
  [
    254, 246, 102, -6.845000000000002, 8.009999999999991,
    0.715, 0.64, "bottom", 2, false,
  ],
  [
    255, 247, 103, -6.909999999999997, 9.20999999999999,
    0.64, 0.715, "bottom", 116, false,
  ],
  [
    256, 248, 103, -6.909999999999997, 10.40499999999999,
    0.64, 0.715, "bottom", 2, false,
  ],
  [
    517, 496, 120, 0.6899999999999977, 11.499999999999996,
    0.35, 0.35, "top", null, true,
  ],
  [518, 497, 120, 0.6899999999999977, 10.849999999999998, 0.35, 0.35, "top", 2, true],
  [
    519, 498, 120, 0.6899999999999977, 10.199999999999998,
    0.35, 0.35, "top", null, true,
  ],
  [
    520, 499, 120, 0.6899999999999977, 9.549999999999997,
    0.35, 0.35, "top", null, true,
  ],
  [521, 500, 120, 0.6899999999999977, 8.249999999999996, 0.35, 0.35, "top", 12, true],
  [522, 501, 120, 0.6899999999999977, 7.599999999999997, 0.35, 0.35, "top", 2, true],
  [523, 502, 120, 0.6899999999999977, 6.9499999999999975, 0.35, 0.35, "top", 74, true],
  [
    535, 514, 120, 0.03999999999999737, 11.499999999999996,
    0.35, 0.35, "top", null, true,
  ],
  [
    536, 515, 120, 0.03999999999999737, 10.849999999999998,
    0.35, 0.35, "top", null, true,
  ],
  [
    537, 516, 120, 0.03999999999999737, 10.199999999999998,
    0.35, 0.35, "top", null, true,
  ],
  [
    538, 517, 120, 0.03999999999999737, 9.549999999999997,
    0.35, 0.35, "top", null, true,
  ],
  [539, 518, 120, 0.03999999999999737, 8.899999999999997, 0.35, 0.35, "top", 2, true],
  [540, 519, 120, 0.03999999999999737, 8.249999999999996, 0.35, 0.35, "top", 13, true],
  [541, 520, 120, 0.03999999999999737, 7.599999999999997, 0.35, 0.35, "top", 80, true],
  [542, 521, 120, 0.03999999999999737, 6.9499999999999975, 0.35, 0.35, "top", 81, true],
  [
    553, 532, 120, -0.6100000000000021, 10.849999999999998,
    0.35, 0.35, "top", null, true,
  ],
  [554, 533, 120, -0.6100000000000021, 9.549999999999997, 0.35, 0.35, "top", 2, true],
  [555, 534, 120, -0.6100000000000021, 7.599999999999997, 0.35, 0.35, "top", 88, true],
  [1, 1, 0, -11.490000000000009, 6.1649999999999965, 0.62, 0.735, "bottom", 1, false],
  [
    22, 22, 11, -10.060000000000002, 12.012499999999998,
    0.62, 0.735, "bottom", 1, false,
  ],
  [
    212, 204, 81, -11.469999999999999, 8.704999999999988,
    0.64, 0.715, "bottom", 1, false,
  ],
  [
    233, 225, 92, -11.480000000000018, 9.824999999999985,
    0.64, 0.715, "bottom", 1, false,
  ],
]

const peripheralPads: Obstacle[] = peripheralPadTuples.map(
  ([
    portId,
    padId,
    componentId,
    x,
    y,
    width,
    height,
    layer,
    netId,
    circle,
  ]): Obstacle => ({
    type: "rect",
    ...(circle ? { shape: "circle" as const } : {}),
    componentId: `pcb_component_${componentId}`,
    circuitJsonMetadata: {
      pcb_port_id: `pcb_port_${portId}`,
      pcb_smtpad_id: `pcb_smtpad_${padId}`,
    },
    center: { x, y },
    width,
    height,
    layers: [layer],
    connectedTo: [
      `pcb_port_${portId}`,
      ...(netId === null ? [] : [`source_net_${netId}`]),
    ],
    ...(netId === 2
      ? {
          offBoardConnectsTo: ["source_component_internal_connection_0"],
          netIsAssignable: true,
        }
      : {}),
  }),
)

const memoryPadNets = [
  [0, 91, 92, 93, 0, 2],
  [2, 0, 2, 67, 94, 2],
  [0, 95, 96, 68, 97, 0],
  [2, 0, 78, 98, 2, 0],
  [2, 2, 99, 69, 2, 0],
  [0, 100, 79, 101, 102, 2],
  [2, 103, 87, 0, 2, 2],
  [1, 0, 104, 105, 106, 0],
  [60, 2, 74, 12, 2, 61],
  [59, 0, 57, 13, 0, 88],
  [58, 66, 90, 84, 116, 115],
  [2, 65, 85, 83, 1, 2],
  [0, 72, 64, 63, 80, 0],
  [2, 73, 75, 70, 81, 2],
  [0, 77, 76, 82, 56, 0],
  [2, 86, 71, 62, 89, 2],
]
const columnOffsets = [-3.2, -2.4, -1.6, 1.6, 2.4, 3.2]
const rowOffsets = [
  6, 5.2, 4.4, 3.6, 2.8, 2, 1.2, 0.4, -0.4, -1.2, -2, -2.8, -3.6, -4.4, -5.2, -6,
]
const memoryPads = memoryPadNets.flatMap((nets, row): Obstacle[] =>
  nets.map((netId, column): Obstacle => {
    const padIndex = row * 6 + column
    return {
      type: "rect",
      shape: "circle",
      componentId: "pcb_component_121",
      circuitJsonMetadata: {
        pcb_port_id: `pcb_port_${560 + padIndex}`,
        pcb_smtpad_id: `pcb_smtpad_${539 + padIndex}`,
      },
      center: {
        x: -6.819999999999993 + columnOffsets[column],
        y: 10.539999999999992 + rowOffsets[row],
      },
      width: 0.4,
      height: 0.4,
      layers: ["top"],
      connectedTo: [
        `pcb_port_${560 + padIndex}`,
        ...(netId === null ? [] : [`source_net_${netId}`]),
      ],
      ...(netId === 2
        ? {
            offBoardConnectsTo: ["source_component_internal_connection_0"],
            netIsAssignable: true,
          }
        : {}),
    }
  }),
)

const retainedTraces: SimplifiedPcbTrace[] = [
  {
    type: "pcb_trace",
    pcb_trace_id: "source_net_88_0",
    connection_name: "source_net_88",
    connectsTo: ["pcb_port_555", "pcb_port_619"],
    route: [
      {
        route_type: "wire",
        x: -0.6100000000000021,
        y: 7.599999999999997,
        width: 0.0975,
        layer: "top",
      },
      {
        route_type: "wire",
        x: -0.7392626312022805,
        y: 7.653769621299237,
        width: 0.0975,
        layer: "top",
      },
      {
        route_type: "wire",
        x: -1.3748884581786438,
        y: 7.67,
        width: 0.0975,
        layer: "top",
      },
      {
        route_type: "via",
        x: -1.3748884581786438,
        y: 7.67,
        from_layer: "top",
        to_layer: "inner2",
        via_diameter: 0.35,
        via_hole_diameter: 0.15,
      },
      {
        route_type: "wire",
        x: -1.3748884581786438,
        y: 7.67,
        width: 0.0975,
        layer: "inner2",
      },
      {
        route_type: "wire",
        x: -3.1348884581786436,
        y: 9.289999999999994,
        width: 0.0975,
        layer: "inner2",
      },
      {
        route_type: "via",
        x: -3.1348884581786436,
        y: 9.289999999999994,
        from_layer: "inner2",
        to_layer: "top",
        via_diameter: 0.35,
        via_hole_diameter: 0.15,
      },
      {
        route_type: "wire",
        x: -3.1348884581786436,
        y: 9.289999999999994,
        width: 0.0975,
        layer: "top",
      },
      {
        route_type: "wire",
        x: -3.619999999999993,
        y: 9.339999999999993,
        width: 0.0975,
        layer: "top",
      },
    ],
  },
  {
    type: "pcb_trace",
    pcb_trace_id: "source_net_13_mst0_0",
    connection_name: "source_net_13",
    connectsTo: ["pcb_port_133", "pcb_port_540"],
    route: [
      {
        route_type: "wire",
        x: 0.03999999999999737,
        y: 8.249999999999996,
        width: 0.093,
        layer: "top",
      },
      {
        route_type: "wire",
        x: -1.259388458178643,
        y: 8.731499999999993,
        width: 0.093,
        layer: "top",
      },
      {
        route_type: "via",
        x: -1.259388458178643,
        y: 8.731499999999993,
        from_layer: "top",
        to_layer: "bottom",
        via_diameter: 0.35,
        via_hole_diameter: 0.15,
      },
      {
        route_type: "wire",
        x: -1.259388458178643,
        y: 8.731499999999993,
        width: 0.093,
        layer: "bottom",
      },
      {
        route_type: "wire",
        x: -0.6299999999999955,
        y: 8.819999999999988,
        width: 0.093,
        layer: "bottom",
      },
    ],
  },
  {
    type: "pcb_trace",
    pcb_trace_id: "source_net_13_mst1_0",
    connection_name: "source_net_13",
    connectsTo: ["pcb_port_252", "pcb_port_617"],
    route: [
      {
        route_type: "wire",
        x: -5.2199999999999935,
        y: 9.339999999999993,
        width: 0.093,
        layer: "top",
      },
      {
        route_type: "wire",
        x: -4.819999999999986,
        y: 9.74,
        width: 0.093,
        layer: "top",
      },
      {
        route_type: "wire",
        x: -3.385787090024423,
        y: 9.74,
        width: 0.093,
        layer: "top",
      },
      {
        route_type: "wire",
        x: -3.2025447732521553,
        y: 9.74,
        width: 0.093,
        layer: "top",
      },
      {
        route_type: "wire",
        x: -3.169749326945137,
        y: 9.772795446307018,
        width: 0.093,
        layer: "top",
      },
      {
        route_type: "via",
        x: -3.169749326945137,
        y: 9.772795446307018,
        from_layer: "top",
        to_layer: "bottom",
        via_diameter: 0.35,
        via_hole_diameter: 0.15,
      },
      {
        route_type: "wire",
        x: -3.169749326945137,
        y: 9.772795446307018,
        width: 0.093,
        layer: "bottom",
      },
      {
        route_type: "wire",
        x: -5.452795446307019,
        y: 9.772795446307018,
        width: 0.093,
        layer: "bottom",
      },
      {
        route_type: "wire",
        x: -6.31207051583461,
        y: 10.63207051583461,
        width: 0.093,
        layer: "bottom",
      },
      {
        route_type: "wire",
        x: -6.31207051583461,
        y: 11.04207051583461,
        width: 0.093,
        layer: "bottom",
      },
      {
        route_type: "wire",
        x: -6.7100000000000115,
        y: 11.439999999999998,
        width: 0.093,
        layer: "bottom",
      },
    ],
  },
  {
    type: "pcb_trace",
    pcb_trace_id: "source_net_13_mst2_0",
    connection_name: "source_net_13",
    connectsTo: ["pcb_port_617", "pcb_port_133"],
    route: [
      {
        route_type: "wire",
        x: -5.2199999999999935,
        y: 9.339999999999993,
        width: 0.093,
        layer: "top",
      },
      {
        route_type: "wire",
        x: -4.42,
        y: 8.917499999999993,
        width: 0.093,
        layer: "top",
      },
      {
        route_type: "wire",
        x: -2.1893884581786427,
        y: 8.9,
        width: 0.093,
        layer: "top",
      },
      {
        route_type: "via",
        x: -2.1893884581786427,
        y: 8.9,
        from_layer: "top",
        to_layer: "bottom",
        via_diameter: 0.35,
        via_hole_diameter: 0.15,
      },
      {
        route_type: "wire",
        x: -2.1893884581786427,
        y: 8.9,
        width: 0.093,
        layer: "bottom",
      },
      {
        route_type: "wire",
        x: -0.6299999999999955,
        y: 8.819999999999988,
        width: 0.093,
        layer: "bottom",
      },
    ],
  },
]

export const h616ViaTopologyInput: SimpleRouteJson = {
  bounds: { minX: -12, maxX: 1.5, minY: 3.5, maxY: 17.5 },
  layerCount: 4,
  allowBlindAndBuriedVias: false,
  allowViaInPad: false,
  minTraceWidth: 0.08,
  minViaDiameter: 0.35,
  minViaHoleDiameter: 0.15,
  minViaPadDiameter: 0.35,
  min_via_hole_diameter: 0.15,
  min_via_pad_diameter: 0.35,
  minTraceToPadEdgeClearance: 0.1,
  minTraceToHoleEdgeClearance: 0.2,
  minViaEdgeToPadEdgeClearance: 0.1,
  minViaHoleEdgeToViaHoleEdgeClearance: 0.1,
  minPlatedHoleDrillEdgeToDrillEdgeClearance: 0.15,
  minPadEdgeToPadEdgeClearance: 0.1,
  minBoardEdgeClearance: 0.2,
  nominalTraceWidth: 0.08,
  obstacles: [
    ...peripheralPads.slice(0, 29),
    ...memoryPads,
    ...peripheralPads.slice(29),
  ],
  traces: retainedTraces,
  connections: [
    {
      name: "source_net_1",
      nominalTraceWidth: 0.1,
      width: 0.1,
      pointsToConnect: [
        {
          x: -11.490000000000009,
          y: 6.1649999999999965,
          layer: "bottom",
          pointId: "pcb_port_1",
          pcb_port_id: "pcb_port_1",
        },
        {
          x: -10.060000000000002,
          y: 12.012499999999998,
          layer: "bottom",
          pointId: "pcb_port_22",
          pcb_port_id: "pcb_port_22",
        },
        {
          x: -4.175000000000016,
          y: 8.11999999999999,
          layer: "bottom",
          pointId: "pcb_port_44",
          pcb_port_id: "pcb_port_44",
        },
        {
          x: -11.469999999999999,
          y: 8.704999999999988,
          layer: "bottom",
          pointId: "pcb_port_212",
          pcb_port_id: "pcb_port_212",
        },
        {
          x: -11.480000000000018,
          y: 9.824999999999985,
          layer: "bottom",
          pointId: "pcb_port_233",
          pcb_port_id: "pcb_port_233",
        },
        {
          x: -10.019999999999992,
          y: 10.939999999999992,
          layer: "top",
          pointId: "pcb_port_602",
          pcb_port_id: "pcb_port_602",
        },
        {
          x: -4.419999999999993,
          y: 7.739999999999992,
          layer: "top",
          pointId: "pcb_port_630",
          pcb_port_id: "pcb_port_630",
        },
      ],
    },
    {
      name: "source_net_115",
      nominalTraceWidth: 0.09,
      width: 0.09,
      pointsToConnect: [
        {
          x: -5.650000000000002,
          y: 8.009999999999991,
          layer: "bottom",
          pointId: "pcb_port_253",
          pcb_port_id: "pcb_port_253",
        },
        {
          x: -3.619999999999993,
          y: 8.539999999999992,
          layer: "top",
          pointId: "pcb_port_625",
          pcb_port_id: "pcb_port_625",
        },
      ],
    },
    {
      name: "source_net_116",
      nominalTraceWidth: 0.1,
      width: 0.1,
      pointsToConnect: [
        {
          x: -6.909999999999997,
          y: 9.20999999999999,
          layer: "bottom",
          pointId: "pcb_port_255",
          pcb_port_id: "pcb_port_255",
        },
        {
          x: -4.419999999999993,
          y: 8.539999999999992,
          layer: "top",
          pointId: "pcb_port_624",
          pcb_port_id: "pcb_port_624",
        },
      ],
    },
  ],
}

// Render-only labels use the native board's component names.
export const h616ViaTopologyLabels: PcbSilkscreenText[] = [
  {
    text: "U2 DDR3",
    componentId: "pcb_component_121",
    x: -6.82,
    y: 17.1,
    fontSize: 0.42,
  },
  {
    text: "U1 edge",
    componentId: "pcb_component_120",
    x: 0.04,
    y: 12.2,
    fontSize: 0.32,
  },
  {
    text: "R5",
    componentId: "pcb_component_102",
    x: -6.2475,
    y: 8.01,
    fontSize: 0.25,
  },
  {
    text: "R6",
    componentId: "pcb_component_103",
    x: -6.91,
    y: 9.8075,
    fontSize: 0.25,
  },
].map(({ text, componentId, x, y, fontSize }): PcbSilkscreenText => ({
  type: "pcb_silkscreen_text",
  pcb_silkscreen_text_id: `label_${componentId}`,
  pcb_component_id: componentId,
  font: "tscircuit2024",
  text,
  font_size: fontSize,
  layer: "top",
  anchor_position: { x, y },
  anchor_alignment: "center",
}))
