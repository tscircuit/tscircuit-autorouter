import { Point2D } from "./JumperPrepatternSolver2_HyperGraph";

/**
 * Check if two collinear segments overlap and return overlap info.
 * Returns null if no overlap, or info about which segment is outer (contains the other).
 *
 * For segments AB and CD arranged as A-C-D-B (overlap), AB is the outer segment.
 */

export function getCollinearOverlapInfo(
  seg1Start: Point2D,
  seg1End: Point2D,
  seg2Start: Point2D,
  seg2End: Point2D,
): {
  outerSegment: 1 | 2;
  innerStart: Point2D;
  innerEnd: Point2D;
  outerStart: Point2D;
  outerEnd: Point2D;
} | null {
  // Project all points onto segment 1's line to get 1D positions
  const dx = seg1End.x - seg1Start.x;
  const dy = seg1End.y - seg1Start.y;
  const len = Math.sqrt(dx * dx + dy * dy);

  if (len < 1e-9) return null;

  // Get 1D positions along the line
  const getT = (p: Point2D): number => {
    return ((p.x - seg1Start.x) * dx + (p.y - seg1Start.y) * dy) / (len * len);
  };

  const t1Start = 0;
  const t1End = 1;
  const t2Start = getT(seg2Start);
  const t2End = getT(seg2End);

  // Normalize so tXStart < tXEnd
  const [t1Min, t1Max] = [Math.min(t1Start, t1End), Math.max(t1Start, t1End)];
  const [t2Min, t2Max] = [Math.min(t2Start, t2End), Math.max(t2Start, t2End)];

  // Check for overlap
  const overlapMin = Math.max(t1Min, t2Min);
  const overlapMax = Math.min(t1Max, t2Max);

  if (overlapMax <= overlapMin + 1e-6) {
    return null; // No overlap
  }

  // Determine which segment is outer (contains the other or is longer in overlap region)
  const seg1ContainsSeg2 = t1Min <= t2Min && t1Max >= t2Max;
  const seg2ContainsSeg1 = t2Min <= t1Min && t2Max >= t1Max;

  if (seg1ContainsSeg2) {
    return {
      outerSegment: 1,
      outerStart: seg1Start,
      outerEnd: seg1End,
      innerStart: seg2Start,
      innerEnd: seg2End,
    };
  } else if (seg2ContainsSeg1) {
    return {
      outerSegment: 2,
      outerStart: seg2Start,
      outerEnd: seg2End,
      innerStart: seg1Start,
      innerEnd: seg1End,
    };
  }

  // Partial overlap - the one that extends further is "outer"
  const seg1Span = t1Max - t1Min;
  const seg2Span = t2Max - t2Min;

  if (seg1Span >= seg2Span) {
    return {
      outerSegment: 1,
      outerStart: seg1Start,
      outerEnd: seg1End,
      innerStart: seg2Start,
      innerEnd: seg2End,
    };
  } else {
    return {
      outerSegment: 2,
      outerStart: seg2Start,
      outerEnd: seg2End,
      innerStart: seg1Start,
      innerEnd: seg1End,
    };
  }
}
