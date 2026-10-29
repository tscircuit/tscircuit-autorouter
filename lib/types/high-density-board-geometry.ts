import type { SimpleRouteJson } from "./srj-types"

/** Physical board geometry retained when routing one rectangular mesh node. */
export type HighDensityBoardGeometry = Pick<
  SimpleRouteJson,
  "bounds" | "outline" | "minBoardEdgeClearance"
>
