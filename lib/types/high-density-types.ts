export type PortPoint = {
  connectionName: string;
  x: number;
  y: number;
  z: number;
  // Optional trace properties - will be populated from SimpleRouteConnection
  traceThickness?: number;
  viaDiameter?: number;
};

export type NodeWithPortPoints = {
  capacityMeshNodeId: string;
  center: { x: number; y: number };
  width: number;
  height: number;
  portPoints: PortPoint[];
  availableZ?: number[];
};

/**
 * A path for a wire in high-density intra-node routing.
 *
 * Wires travel along a route, and are placed to avoid other
 * wires at the same z-level. Any time a z level is changed,
 * you must place a via.
 *
 * z is an integer corresponding to the layer index
 *
 * z=0: top layer for 2 layer boards
 * z=1: bottom layer for 2 layer boards
 *
 * z must be an integer
 */
export type HighDensityIntraNodeRoute = {
  connectionName: string;
  traceThickness: number;
  viaDiameter: number;
  route: Array<{ x: number; y: number; z: number }>;
  vias: Array<{ x: number; y: number }>;
};

export type HighDensityRoute = HighDensityIntraNodeRoute;
