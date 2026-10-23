import type { RelaxTraceClearanceInput } from "@tscircuit/repair04"

// Resolve the exact types of the pinned repair04 input, rather than whichever
// independent high-density-repair03 version the parent workspace installs.
export type SimpleRouteJson = RelaxTraceClearanceInput["srj"]
export type HighDensityRoute = RelaxTraceClearanceInput["routes"][number]
export type SimplifiedPcbTrace = NonNullable<SimpleRouteJson["traces"]>[number]
