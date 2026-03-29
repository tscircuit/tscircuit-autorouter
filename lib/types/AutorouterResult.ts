export interface RoutedSegment {
  x: number
  y: number
  layer: string
  /** Width of this segment in millimetres */
  width: number
}

export interface RoutedTrace {
  /** Matches the connection name from SimpleRouteConnection */
  connectionName: string
  route: RoutedSegment[]
}

export interface AutorouterResult {
  /** Successfully routed connections */
  traces: RoutedTrace[]
  /** Connection names that could not be routed */
  failedConnections?: string[]
}
