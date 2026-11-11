import type { SimplifiedPcbTrace } from "./srj-types"

export type DifferentialPairFailure =
  | {
      reason: "length_skew"
      pairIndex: number
      laneLengthsMm: [number, number]
    }
  | {
      reason: "missing_hop_route" | "ownership_violation"
      pairIndex: number
      connectionName: string
    }
  | {
      reason: "invalid_differential_pair" | "unsupported_routing_scope"
      pairIndex: number
      connectionName?: string
      detail: string
    }

export type RoutingFailure =
  | DifferentialPairFailure
  | { reason: "routing_failed"; message: string }

export type RouterResult =
  | { status: "solved"; traces: SimplifiedPcbTrace[] }
  | { status: "failed"; failure: RoutingFailure }
