import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost as Native } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"

// Initial Native task0 from the production ordinary-node capture srj18-01-node-140.
// Full capture input SHA256: 759d8536e3e6972f52c1ad737589882ffc21a520cb3a581e1ff2681769da56f4
// Connectivity keeps the original complete groups referenced by this native query.
const netMap = {
  "connectivity_net19": [
    "source_trace_39__source_net_39_mst0",
    "source_trace_39",
    "source_net_39",
    "1470,-672:0",
    "pcb_port_151",
    "1590,-446:0",
    "pcb_port_225",
    "source_trace_39__source_net_39_mst1",
    "2464,-140:0",
    "pcb_port_134",
    "2934,-127:0",
    "pcb_port_190",
    "source_trace_39__source_net_39_mst2",
    "-3214,2048:0",
    "pcb_port_75",
    "-2374,2048:0",
    "pcb_port_74",
    "source_trace_39__source_net_39_mst3",
    "source_trace_39__source_net_39_mst4",
    "-451,-952:0",
    "pcb_port_108",
    "-127,-2413:0",
    "pcb_port_126",
    "source_trace_39__source_net_39_mst5",
    "source_trace_39__source_net_39_mst6",
    "pcb_smtpad_59",
    "connectivity_net987",
    "pcb_trace_54",
    "pcb_trace_53",
    "pcb_trace_52",
    "pcb_trace_51",
    "pcb_trace_50",
    "pcb_trace_49",
    "pcb_trace_48",
    "pcb_trace_47",
    "pcb_component_18_port_1",
    "pcb_smtpad_60",
    "pcb_component_18_port_2",
    "pcb_smtpad_84",
    "pcb_component_28_port_4",
    "pcb_plated_hole_30",
    "pcb_component_30_port_6",
    "pcb_smtpad_103",
    "pcb_component_33_port_2",
    "pcb_smtpad_120",
    "pcb_component_36_port_13",
    "pcb_plated_hole_37",
    "pcb_component_38_port_5",
    "pcb_smtpad_183",
    "pcb_component_47_port_13",
    "-127,-2413:0-1",
    "2934,-127:0-1"
  ],
  "connectivity_net22": [
    "source_trace_32__source_net_32_mst0",
    "source_trace_32",
    "source_net_32",
    "1614,-1116:0",
    "pcb_port_142",
    "1840,-1176:0",
    "pcb_port_216",
    "source_trace_32__source_net_32_mst1",
    "-2089,953:0",
    "pcb_port_60",
    "pcb_smtpad_45",
    "connectivity_net1068",
    "pcb_trace_135",
    "pcb_trace_134",
    "pcb_component_14_port_1",
    "pcb_smtpad_111",
    "pcb_component_36_port_4",
    "pcb_smtpad_174",
    "pcb_component_47_port_4"
  ],
  "connectivity_net23": [
    "source_trace_31__source_net_31_mst0",
    "source_trace_31",
    "source_net_31",
    "-875,-1206:0",
    "pcb_port_57",
    "-839,-857:0",
    "pcb_port_208",
    "source_trace_31__source_net_31_mst1",
    "127,-2413:0",
    "pcb_port_125",
    "source_trace_31__source_net_31_mst2",
    "-1301,973:0",
    "pcb_port_118",
    "pcb_smtpad_42",
    "connectivity_net1107",
    "pcb_trace_174",
    "pcb_trace_173",
    "pcb_trace_172",
    "pcb_trace_171",
    "pcb_component_12_port_2",
    "pcb_smtpad_94",
    "pcb_component_29_port_6",
    "pcb_plated_hole_29",
    "pcb_component_30_port_5",
    "pcb_smtpad_166",
    "pcb_component_44_port_5",
    "127,-2413:0-1"
  ],
  "connectivity_net26": [
    "source_trace_28__source_net_28_mst0",
    "source_trace_28",
    "source_net_28",
    "-1431,551:0",
    "pcb_port_113",
    "-1366,551:0",
    "pcb_port_114",
    "source_trace_28__source_net_28_mst1",
    "-2089,-231:0",
    "pcb_port_49",
    "pcb_smtpad_34",
    "connectivity_net1111",
    "pcb_trace_178",
    "pcb_trace_177",
    "pcb_trace_176",
    "pcb_component_11_port_2",
    "pcb_smtpad_89",
    "pcb_component_29_port_1",
    "pcb_smtpad_90",
    "pcb_component_29_port_2"
  ],
  "connectivity_net42": [
    "source_trace_12__source_net_12_mst0",
    "source_trace_12",
    "source_net_12",
    "1614,-966:0",
    "pcb_port_145",
    "1840,-936:0",
    "pcb_port_219",
    "source_trace_12__source_net_12_mst1",
    "-2003,191:0",
    "pcb_port_70",
    "-1771,191:0",
    "pcb_port_26",
    "source_trace_12__source_net_12_mst2",
    "2209,-864:0",
    "pcb_port_90",
    "source_trace_12__source_net_12_mst3",
    "-1936,1715:0",
    "pcb_port_184",
    "-1607,1168:0",
    "pcb_port_193",
    "source_trace_12__source_net_12_mst4",
    "source_trace_12__source_net_12_mst5",
    "pcb_smtpad_22",
    "connectivity_net954",
    "pcb_trace_21",
    "pcb_trace_20",
    "pcb_trace_19",
    "pcb_trace_18",
    "pcb_trace_17",
    "pcb_trace_16",
    "pcb_component_3_port_3",
    "pcb_smtpad_55",
    "pcb_component_16_port_1",
    "pcb_smtpad_76",
    "pcb_component_24_port_2",
    "pcb_smtpad_114",
    "pcb_component_36_port_7",
    "pcb_smtpad_153",
    "pcb_component_37_port_1",
    "pcb_smtpad_157",
    "pcb_component_40_port_2",
    "pcb_smtpad_177",
    "pcb_component_47_port_7"
  ],
  "connectivity_net44": [
    "source_trace_10__source_net_10",
    "source_trace_10",
    "source_net_10",
    "-1531,96:0",
    "pcb_port_24",
    "-1366,973:0",
    "pcb_port_119",
    "pcb_smtpad_20",
    "connectivity_net1108",
    "pcb_trace_175",
    "pcb_component_3_port_1",
    "pcb_smtpad_95",
    "pcb_component_29_port_7"
  ]
}

export const reversePotentialCapturedNode140Options = {
  ...{
  "connectionName": "source_trace_10__source_net_10",
  "rootConnectionName": "connectivity_net44",
  "A": {
    "x": -15.0475,
    "y": 3.254999999999999,
    "z": 1
  },
  "B": {
    "x": -14.510000000000002,
    "y": 9.107499999999998,
    "z": 1
  },
  "regionId": "cmn_8",
  "obstacleRoutes": [],
  "futureConnections": [
    {
      "connectionName": "source_trace_28__source_net_28_mst1",
      "rootConnectionName": "connectivity_net26",
      "points": [
        {
          "x": -17.8975,
          "y": 3.254999999999999,
          "z": 1
        },
        {
          "x": -14.510000000000002,
          "y": 5.3825,
          "z": 0
        }
      ]
    },
    {
      "connectionName": "source_trace_32__source_net_32_mst1",
      "rootConnectionName": "connectivity_net22",
      "points": [
        {
          "x": -20.090000000000003,
          "y": 8.649999999999999,
          "z": 0
        },
        {
          "x": -16.472499999999997,
          "y": 3.254999999999999,
          "z": 1
        }
      ]
    },
    {
      "connectionName": "source_trace_31__source_net_31_mst2",
      "rootConnectionName": "connectivity_net23",
      "points": [
        {
          "x": -14.510000000000002,
          "y": 10.876999999999999,
          "z": 0
        },
        {
          "x": -14.510000000000002,
          "y": 4.015000000000001,
          "z": 0
        }
      ]
    },
    {
      "connectionName": "source_trace_12__source_net_12_mst4",
      "rootConnectionName": "connectivity_net42",
      "points": [
        {
          "x": -16.472499999999997,
          "y": 3.254999999999999,
          "z": 0
        },
        {
          "x": -16.277499999999996,
          "y": 11.209,
          "z": 0
        }
      ]
    },
    {
      "connectionName": "source_trace_12__source_net_12_mst1",
      "rootConnectionName": "connectivity_net42",
      "points": [
        {
          "x": -18.9875,
          "y": 3.2549999999999994,
          "z": 0
        },
        {
          "x": -17.8975,
          "y": 3.254999999999999,
          "z": 0
        }
      ]
    },
    {
      "connectionName": "source_trace_39__source_net_39_mst6",
      "rootConnectionName": "connectivity_net19",
      "points": [
        {
          "x": -17.590000000000003,
          "y": 11.209,
          "z": 1
        },
        {
          "x": -14.510000000000002,
          "y": 5.8825,
          "z": 1
        }
      ]
    }
  ],
  "bounds": {
    "minX": -20.090000000000003,
    "maxX": -14.510000000000002,
    "minY": 3.254999999999999,
    "maxY": 11.209
  },
  "minDistBetweenEnteringPoints": 1.3674999999999997,
  "layerCount": 2,
  "availableZ": [
    0,
    1
  ],
  "hyperParameters": {},
  "viaDiameter": 0.3,
  "traceThickness": 0.1,
  "obstacleMargin": 0.15,
  "captureSearchDebug": true
},
  connMap: new ConnectivityMap(netMap),
} satisfies ConstructorParameters<typeof Native>[0]
