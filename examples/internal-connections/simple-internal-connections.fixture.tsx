import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import { SimpleRouteJson } from "lib/types"
import React from "react"

/**
 * Super Simple Internal Connections Example
 *
 * This is the simplest possible example to demonstrate internallyConnectedInsideTheChip.
 *
 * Imagine individual component pads on a PCB:
 * - Battery pads: BATTERY_PLUS, BATTERY_MINUS, BATTERY_STATUS
 * - Chip pads: CHIP_VDD1, CHIP_VDD2, CHIP_VDD3 (internally connected)
 * - Chip pads: CHIP_GND1, CHIP_GND2 (internally connected)
 * - Chip pad: CHIP_ENABLE (normal routing)
 *
 * Each pad is represented as a separate obstacle (like real PCB pads!)
 *
 * Without internallyConnectedInsideTheChip: The autorouter would try to
 * externally connect CHIP_VDD1, CHIP_VDD2, and CHIP_VDD3 together.
 *
 * With internallyConnectedInsideTheChip: The autorouter knows these 3 pads
 * are already connected internally (like RP2040 IOVDD pins), so it only
 * routes the battery to one representative pad.
 *
 * Visual representation:
 *
 * BEFORE (without internal connections):
 *     [BATTERY_PLUS] ----→ [CHIP_VDD1]
 *       ↓                      ↓
 *      [CHIP_VDD2] ←----------→ [CHIP_VDD3]
 *     (messy external routing between chip pads)
 *
 * AFTER (with internal connections):
 *     [BATTERY_PLUS] ----→ [CHIP_VDD1]  ([CHIP_VDD2] and [CHIP_VDD3] are already connected internally)
 *     (clean, simple routing - no unnecessary traces between chip pads)
 */

export const simpleInternalConnections: SimpleRouteJson = {
  bounds: {
    minX: -5,
    maxX: 15,
    minY: -5,
    maxY: 5,
  },

  // Individual pads for each pin - positioned realistically on component borders!
  obstacles: [
    // Battery pads - arranged vertically like a real battery connector
    {
      type: "rect",
      layers: ["top"],
      center: { x: -2, y: 0 },
      width: 1.5,
      height: 0.8,
      connectedTo: ["BATTERY_PLUS"],
    },
    {
      type: "rect",
      layers: ["top"],
      center: { x: -2, y: -2 },
      width: 1.5,
      height: 0.8,
      connectedTo: ["BATTERY_MINUS"],
    },
    {
      type: "rect",
      layers: ["top"],
      center: { x: -2, y: 2 },
      width: 1.5,
      height: 0.8,
      connectedTo: ["BATTERY_STATUS"],
    },

    // Chip VDD pads - positioned on the TOP edge of the chip (like real IC pins)
    {
      type: "rect",
      layers: ["top"],
      center: { x: 6, y: 3.5 }, // Top edge
      width: 1.2,
      height: 0.6,
      connectedTo: ["CHIP_VDD1"],
    },
    {
      type: "rect",
      layers: ["top"],
      center: { x: 8, y: 3.5 }, // Top edge
      width: 1.2,
      height: 0.6,
      connectedTo: ["CHIP_VDD2"],
    },
    {
      type: "rect",
      layers: ["top"],
      center: { x: 10, y: 3.5 }, // Top edge
      width: 1.2,
      height: 0.6,
      connectedTo: ["CHIP_VDD3"],
    },

    // Chip GND pads - positioned on the BOTTOM edge of the chip
    {
      type: "rect",
      layers: ["top"],
      center: { x: 6, y: -3.5 }, // Bottom edge
      width: 1.2,
      height: 0.6,
      connectedTo: ["CHIP_GND1"],
    },
    {
      type: "rect",
      layers: ["top"],
      center: { x: 10, y: -3.5 }, // Bottom edge
      width: 1.2,
      height: 0.6,
      connectedTo: ["CHIP_GND2"],
    },

    // Chip enable pad - positioned on the SIDE edge of the chip
    {
      type: "rect",
      layers: ["top"],
      center: { x: 11.5, y: 0 }, // Right edge
      width: 1.2,
      height: 0.6,
      connectedTo: ["CHIP_ENABLE"],
    },
  ],

  connections: [
    {
      name: "SIMPLE_POWER",
      pointsToConnect: [
        // Battery positive terminal
        {
          x: -2,
          y: 0,
          layer: "top",
          pointId: "BATTERY_PLUS",
          pcb_port_id: "battery_plus",
        },

        // Chip has 3 VDD pins that are INTERNALLY CONNECTED
        // In a real chip like RP2040, these would be multiple IOVDD pins
        // Positioned on the TOP edge of the chip (realistic pin placement!)
        {
          x: 6,
          y: 3.5,
          layer: "top",
          pointId: "CHIP_VDD1",
          pcb_port_id: "chip_vdd1",
        },
        {
          x: 8,
          y: 3.5,
          layer: "top",
          pointId: "CHIP_VDD2",
          pcb_port_id: "chip_vdd2",
        },
        {
          x: 10,
          y: 3.5,
          layer: "top",
          pointId: "CHIP_VDD3",
          pcb_port_id: "chip_vdd3",
        },
      ],
      // 🔑 KEY: Tell the autorouter these chip pins are already connected internally
      internallyConnectedInsideTheChip: [
        ["CHIP_VDD1", "CHIP_VDD2", "CHIP_VDD3"],
      ],
    },

    {
      name: "SIMPLE_GROUND",
      pointsToConnect: [
        // Battery negative terminal
        {
          x: -2,
          y: -2,
          layer: "top",
          pointId: "BATTERY_MINUS",
          pcb_port_id: "battery_minus",
        },

        // Chip ground pins (also internally connected)
        // Positioned on the BOTTOM edge of the chip (realistic pin placement!)
        {
          x: 6,
          y: -3.5,
          layer: "top",
          pointId: "CHIP_GND1",
          pcb_port_id: "chip_gnd1",
        },
        {
          x: 10,
          y: -3.5,
          layer: "top",
          pointId: "CHIP_GND2",
          pcb_port_id: "chip_gnd2",
        },
      ],
      // Ground pins are also internally connected through the chip
      internallyConnectedInsideTheChip: [["CHIP_GND1", "CHIP_GND2"]],
    },

    {
      name: "SIMPLE_DATA",
      pointsToConnect: [
        // Single data connection (no internal connections)
        // Positioned on the SIDE edge of the chip (realistic pin placement!)
        {
          x: -2,
          y: 2,
          layer: "top",
          pointId: "BATTERY_STATUS",
          pcb_port_id: "battery_status",
        },
        {
          x: 11.5,
          y: 0,
          layer: "top",
          pointId: "CHIP_ENABLE",
          pcb_port_id: "chip_enable",
        },
      ],
      // No internallyConnectedInsideTheChip - this needs external routing
    },
  ],

  layerCount: 2,
  minTraceWidth: 0.15,
  minViaDiameter: 0.6,
}

export default () => {
  return React.createElement(AutoroutingPipelineDebugger, {
    srj: simpleInternalConnections,
  })
}
