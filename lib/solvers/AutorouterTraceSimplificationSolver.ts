import { TraceSimplificationSolver } from "@tscircuit/trace-simplification-solver"

type AutorouterTraceSimplificationOptions = ConstructorParameters<
  typeof TraceSimplificationSolver
>[0]

/** Cleanup policy for newly routed copper and mutable preloaded sections. */
export class AutorouterTraceSimplificationSolver extends TraceSimplificationSolver {
  constructor(options: AutorouterTraceSimplificationOptions) {
    super({
      ...options,
      useTraceWidthAwareClearance: true,
      enableVertexShortcuts: true,
    })
    // The last path pass can clear space for another via-removal pass. Revisit
    // those opportunities once, keeping the amount of cleanup work bounded.
    this.MAX_SIMPLIFICATION_PIPELINE_LOOPS = 3
  }
}
