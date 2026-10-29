import type { ClearancePathInput } from "@tscircuit/repair04"

// Derive the nested repair03 contract from repair04 rather than its older sibling.
export type SimpleRouteJson = ClearancePathInput["srj"]
export type HighDensityRoute = ClearancePathInput["routes"][number]
export type SimplifiedPcbTrace = NonNullable<SimpleRouteJson["traces"]>[number]
