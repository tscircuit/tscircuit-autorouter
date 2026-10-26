export interface HighDensityHyperParameters {
  FUTURE_CONNECTION_PROX_TRACE_PENALTY_FACTOR: number
  FUTURE_CONNECTION_PROX_VIA_PENALTY_FACTOR: number
  FUTURE_CONNECTION_PROXIMITY_VD: number
  /**
   * Alternative to FUTURE_CONNECTION_PROXIMITY_VD that accepts mm
   * Used by high density w/ jumpers solver
   * */
  FUTURE_CONNECTION_TRACE_PROXIMITY: number
  MISALIGNED_DIST_PENALTY_FACTOR: number
  VIA_PENALTY_FACTOR_2: number
  SHUFFLE_SEED: number
  CELL_SIZE_FACTOR: number
  FLIP_TRACE_ALIGNMENT_DIRECTION: boolean

  // Hyper Parameters for Multi-Head Polyline Solver
  MULTI_HEAD_POLYLINE_SOLVER: boolean
  SEGMENTS_PER_POLYLINE: number
  BOUNDARY_PADDING: number

  ITERATION_PENALTY: number

  //  NEW  – minimum gap that still counts as success when no perfect
  //  solution is found (checked only at the very end, never used
  //  as a normal "solved" criterion during the search)
  MINIMUM_FINAL_ACCEPTANCE_GAP?: number

  // Obstacle proximity penalty parameters (repulsive field)
  OBSTACLE_PROX_PENALTY_FACTOR?: number // λ - how strong the penalty is
  OBSTACLE_PROX_SIGMA?: number // σ in mm - how far the repulsion reaches

  // Edge proximity penalty parameters
  EDGE_PROX_PENALTY_FACTOR?: number
  EDGE_PROX_SIGMA?: number

  // Whether to allow diagonal movement in pathfinding
  ALLOW_DIAGONAL?: boolean

  // Future connection jumper pad penalty parameters
  FUTURE_CONNECTION_JUMPER_PAD_PROXIMITY?: number // mm - proximity threshold for jumper pads to future connections
  FUTURE_CONNECTION_JUMPER_PAD_PENALTY?: number // penalty factor for jumper pads near future connection points

  // Jumper-to-jumper pad proximity penalty parameters
  JUMPER_JUMPER_PAD_PROXIMITY?: number // mm - proximity threshold for jumper pads to other jumper pads
  JUMPER_JUMPER_PAD_PENALTY?: number // penalty factor for jumper pads near other jumper pads

  // Future connection line proximity penalty parameters
  // Penalizes nodes that are close to the direct line between future connection start/end points
  FUTURE_CONNECTION_LINE_PROXIMITY?: number // mm - proximity threshold
  FUTURE_CONNECTION_LINE_PENALTY?: number // penalty factor

  // Minimum travel distance before allowing jumper neighbors
  MIN_TRAVEL_BEFORE_JUMPER?: number // mm - default: 3
}
