import { SegmentPointId, UnravelOperation } from "./types";

/**
 * Applies an operation to the point modifications map
 * @param pointModifications The current point modifications map
 * @param operation The operation to apply
 * @param getPointInCandidate Function to get the current point values (with any existing modifications)
 * @returns The modified point modifications map
 */
export const applyOperationToPointModifications = (
  pointModifications: Map<
    SegmentPointId,
    { x?: number; y?: number; z?: number }
  >,
  operation: UnravelOperation,
  getPointInCandidate: (segmentPointId: SegmentPointId) => {
    x: number;
    y: number;
    z: number;
    segmentId: string;
  },
) => {
  if (operation.type === "change_layer") {
    for (const segmentPointId of operation.segmentPointIds) {
      const existingMods = pointModifications.get(segmentPointId) || {};
      pointModifications.set(segmentPointId, {
        ...existingMods,
        z: operation.newZ,
      });
    }
  } else if (operation.type === "swap_position_on_segment") {
    const [ASpId, BSpId] = operation.segmentPointIds;
    const A = getPointInCandidate(ASpId);
    const B = getPointInCandidate(BSpId);

    const existingModsA = pointModifications.get(ASpId) || {};
    const existingModsB = pointModifications.get(BSpId) || {};

    pointModifications.set(ASpId, {
      ...existingModsA,
      x: B.x,
      y: B.y,
    });

    pointModifications.set(BSpId, {
      ...existingModsB,
      x: A.x,
      y: A.y,
    });
  } else if (operation.type === "combined") {
    // For combined operations, recursively apply each operation
    for (const subOperation of operation.operations) {
      // Apply each sub-operation directly to the modifications
      applyOperationToPointModifications(
        pointModifications,
        subOperation,
        getPointInCandidate,
      );
    }
  }
};
