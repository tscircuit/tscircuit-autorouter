export type TraceId = string

export interface SimpleRouteJson {
  layerCount: number
  minTraceWidth: number
  minViaDiameter?: number
  obstacles: Obstacle[]
  connections: Array<SimpleRouteConnection>
  bounds: { minX: number; maxX: number; minY: number; maxY: number }
  outline?: Array<{ x: number; y: number }>
  traces?: SimplifiedPcbTraces
}

export interface Obstacle {
  type: "rect"
  layers: string[]
  zLayers?: number[]
  center: { x: number; y: number }
  width: number
  height: number
  connectedTo: TraceId[]
  netIsAssignable?: boolean
  offBoardConnectsTo?: TraceId[]
}

export interface SimpleRouteConnection {
  name: string
  netConnectionName?: string
  nominalTraceWidth?: number
  pointsToConnect: Array<{
    x: number
    y: number
    layer: string
    pointId?: string
    pcb_port_id?: string
  }>
  /**
   * Defines groups of points that are already connected by some means
   * external to the PCB being routed. This is a strict constraint that
   * prevents the autorouter from creating redundant traces between these points
   * on the PCB.
   *
   * @example
   * // Use case: Two test points (`TP1`, `TP2`) on a PCB that will be
   * // connected by an external test fixture. You want to route from a
   * // resistor (`R1_PAD`) to `TP1`, but not have the router create a
   * // trace between `TP1` and `TP2`.
   *
   * "connections": [
   *   {
   *     "name": "TEST_NET",
   *     "pointsToConnect": [
   *       {"pointId": "TP1", "x": 0, "y": 0},
   *       {"pointId": "TP2", "x": 2, "y": 0},
   *       {"pointId": "R1_PAD", "x": 5, "y": 0}
   *     ],
   *     "alreadyConnectedToExternalComponent": [["TP1", "TP2"]]
   *   }
   * ]
   *
   * // Outcome: A trace is routed from `R1_PAD` to `TP1`, but no trace is
   * // created between `TP1` and `TP2` on the PCB.
   */
  alreadyConnectedToExternalComponent?: string[][]

  /**
   * Defines groups of points that are internally connected within a single
   * component (e.g., multiple ground or VDD pins on a microcontroller).
   * This is an optimization that allows the autorouter to treat all points
   * in a group as a single logical entity. It will create a route to only
   * one "representative" point from the group, assuming the component's
   * internal structure handles the rest.
   *
   * If this were treated as "not connected" (like `alreadyConnectedToExternalComponent`),
   * the autorouter would attempt to connect all points in the group to the rest of the net
   * individually. This would lead to redundant traces on the PCB, as the points are
   * already connected internally within the chip.
   *
   * @example
   * // Use case: A chip has three VDD pins (`VDD1`, `VDD2`, `VDD3`) that
   * // are connected inside the chip. We need to connect them to a power
   * // supply (`PSU_OUT`).
   *
   * "connections": [
   *   {
   *     "name": "POWER_NET",
   *     "pointsToConnect": [
   *       {"pointId": "PSU_OUT", "x": 0, "y": 0},
   *       {"pointId": "VDD1", "x": 10, "y": 0},
   *       {"pointId": "VDD2", "x": 12, "y": 0},
   *       {"pointId": "VDD3", "x": 14, "y": 0}
   *     ],
   *     "internallyConnectedInsideTheChip": [["VDD1", "VDD2", "VDD3"]]
   *   }
   * ]
   *
   * // Outcome: A single, efficient trace is routed from `PSU_OUT` to
   * // just one of the VDD pins (e.g., `VDD1`).
   */
  internallyConnectedInsideTheChip?: string[][]
}

export interface SimplifiedPcbTrace {
  type: "pcb_trace"
  pcb_trace_id: TraceId
  connection_name: string
  route: Array<
    | {
        route_type: "wire"
        x: number
        y: number
        width: number
        layer: string
      }
    | {
        route_type: "via"
        x: number
        y: number
        to_layer: string
        from_layer: string
      }
  >
}

export type SimplifiedPcbTraces = Array<SimplifiedPcbTrace>
