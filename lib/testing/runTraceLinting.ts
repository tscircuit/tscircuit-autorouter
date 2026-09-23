import { validateSimpleRouteJson, PcbTraceLinter } from "@tscircuit/pcb-trace-linter/srj"
import type { SimpleRouteJson } from "../types/srj-types"

/** Analyze the final routing output without changing its geometry. */
export const runTraceLinting = (srj: SimpleRouteJson): PcbTraceLinter => {
  const linter = new PcbTraceLinter({ input: validateSimpleRouteJson(srj) })
  linter.solve()
  if (linter.failed || !linter.solved) {
    throw new Error(linter.error ?? "Trace linting did not complete")
  }
  return linter
}
