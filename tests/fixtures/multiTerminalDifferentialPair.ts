import type { SimpleRouteJson } from "lib/types"

export const multiTerminalDifferentialPair: SimpleRouteJson = {
  layerCount: 2,
  minTraceWidth: 0.15,
  minViaPadDiameter: 0.3,
  bounds: { minX: -2, maxX: 22, minY: -4, maxY: 5 },
  obstacles: [],
  connections: [
    {
      name: "USB_P",
      pointsToConnect: [
        {
          x: 0,
          y: 1,
          layer: "top",
          pcb_port_id: "j_dp",
          port_selector: "J1.DP",
        },
        {
          x: 10,
          y: 1,
          layer: "top",
          pcb_port_id: "esd_dp",
          port_selector: "U1.DP",
        },
        {
          x: 20,
          y: 1,
          layer: "top",
          pcb_port_id: "mcu_dp",
          port_selector: "U2.DP",
        },
      ],
    },
    {
      name: "USB_N",
      // Reverse the order so MST indexes cannot identify corresponding segments.
      pointsToConnect: [
        {
          x: 20,
          y: 0,
          layer: "top",
          pcb_port_id: "mcu_dm",
          port_selector: "U2.DM",
        },
        {
          x: 10,
          y: 0,
          layer: "top",
          pcb_port_id: "esd_dm",
          port_selector: "U1.DM",
        },
        {
          x: 0,
          y: 0,
          layer: "top",
          pcb_port_id: "j_dm",
          port_selector: "J1.DM",
        },
      ],
    },
  ],
  differentialPairs: [
    {
      connectionNames: ["USB_P", "USB_N"],
      lengthTolerance: 0.05,
      traceGap: 0.3,
      maxUncoupledLength: 3,
    },
  ],
}
