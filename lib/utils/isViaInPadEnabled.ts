import type { SimpleRouteJson } from "lib/types"

/** Via-in-pad is an explicit fabrication opt-in, never an automatic repair. */
export const isViaInPadEnabled = (srj: SimpleRouteJson) =>
  srj.allowViaInPad ?? false
