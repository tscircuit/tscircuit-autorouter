import type { PostProcessingError } from "@tscircuit/length-matching-solver"

/** A completed postprocessor returned geometry without satisfying its constraints. */
export class DifferentialPairPostProcessingError extends Error {
  constructor(public readonly diagnostics: readonly PostProcessingError[]) {
    super(
      `Differential pair post-processing failed: ${diagnostics
        .map(
          (diagnostic) =>
            `${diagnostic.stage} (${diagnostic.connectionNames?.join("/") ?? "pair optimization"}, ${diagnostic.reason}): ${diagnostic.message}`,
        )
        .join("; ")}`,
    )
    this.name = "DifferentialPairPostProcessingError"
  }
}
