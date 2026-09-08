import type { FixedCopperRectangle } from "lib/data-structures/FixedCopperClearanceIndex"

export type PhysicalNodeCutContext = {
  readonly rectangles: readonly FixedCopperRectangle[]
  readonly layerCount: number
  readonly traceWidth: number
  readonly traceGap: number
  readonly padGap: number
  readonly routableNetIds: ReadonlySet<string>
  /** Actual source/derived targets, not subsequently allocated graph ports. */
  readonly protectedPoints: readonly Readonly<{ x: number; y: number }>[]
}

export type PhysicalNodeCut = {
  readonly physicalCutId: string
  /** The actual output children on opposite sides of this cut. */
  readonly nodeIds: readonly [string, string]
}

// Twice areNodesBordering's epsilon; thinner slices are coordinate artifacts.
export const MIN_CONNECTIVITY_BRIDGE_DIMENSION = 0.002
