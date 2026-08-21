import { test, expect } from "bun:test";
import { computeDrawPositionFromCollisions } from "../../../lib/solvers/TraceKeepoutSolver/computeDrawPositionFromCollisions";

test("computeDrawPositionFromCollisions should position between colliding segments", () => {
  const input = {
    cursorPosition: {
      x: -32.044111946216205,
      y: 19.47856940245737,
      z: 0,
    },
    lastCursorPosition: {
      x: -31.544120207807335,
      y: 19.475976194894795,
      z: 0,
    },
    collidingSegments: [
      {
        start: { x: -30.648119410807944, y: 19.365268037900005 },
        end: { x: -31.339441888641066, y: 19.365241937993876 },
      },
      {
        start: { x: -30.6481250738466, y: 19.515268037793103 },
        end: { x: -31.339447551679722, y: 19.515241937886973 },
      },
      {
        start: { x: -31.339233103390608, y: 19.3652422364854 },
        end: { x: -31.49226379520055, y: 19.36481044995758 },
      },
      {
        start: { x: -31.33965633693018, y: 19.515241639395448 },
        end: { x: -31.49268702874012, y: 19.51480985286763 },
      },
      {
        start: { x: -31.491633562420716, y: 19.364814876299196 },
        end: { x: -31.64724730458411, y: 19.36306805480202 },
      },
      {
        start: { x: -31.493317261519955, y: 19.514805426526014 },
        end: { x: -31.648931003683348, y: 19.51305860502884 },
      },
      {
        start: { x: -31.646443853093203, y: 19.363081378857284 },
        end: { x: -32.24057196914502, y: 19.35004464676708 },
      },
      {
        start: { x: -31.649734455174254, y: 19.513045280973575 },
        end: { x: -32.243862571226074, y: 19.500008548883372 },
      },
      {
        start: { x: -32.235675337789885, y: 19.350312455117635 },
        end: { x: -32.82960363918214, y: 19.29830839464428 },
      },
      {
        start: { x: -32.24875920258121, y: 19.49974074053282 },
        end: { x: -32.842687503973465, y: 19.447736680059464 },
      },
      {
        start: { x: -32.82674725593556, y: 19.298613722933897 },
        end: { x: -32.978576827928194, y: 19.279436663702736 },
      },
      {
        start: { x: -32.845543887220046, y: 19.447431351769847 },
        end: { x: -32.99737345921268, y: 19.428254292538686 },
      },
      {
        start: { x: -32.97867228823481, y: 19.279424668647792 },
        end: { x: -33.133105560200676, y: 19.26011998225321 },
      },
      {
        start: { x: -32.997277998906064, y: 19.42826628759363 },
        end: { x: -33.15171127087193, y: 19.40896160119905 },
      },
      {
        start: { x: -33.132343222593214, y: 19.26021924780367 },
        end: { x: -33.81738488591631, y: 19.167445656843363 },
      },
      {
        start: { x: -33.15247360847939, y: 19.408862335648593 },
        end: { x: -33.83751527180249, y: 19.316088744688287 },
      },
      // Board edge segments
      { start: { x: 38, y: 19.995 }, end: { x: -38, y: 19.995 } },
      { start: { x: 38, y: 20.005 }, end: { x: -38, y: 20.005 } },
      { start: { x: 38, y: 19.995 }, end: { x: -38, y: 19.995 } },
      { start: { x: 38, y: 20.005 }, end: { x: -38, y: 20.005 } },
    ],
    keepoutRadius: 0.5,
  };

  const result = computeDrawPositionFromCollisions(input);

  // The draw position should be found
  expect(result).not.toBeNull();

  if (result) {
    // At the cursor x position (~-32.04), the trace corridor top edge is around y ≈ 19.5
    // and the board edge is at y ≈ 19.995
    // The draw position should be roughly in the middle: y ≈ 19.75

    // The result should be between the trace corridor (y ~ 19.5) and board edge (y ~ 19.995)
    expect(result.y).toBeGreaterThan(19.5);
    expect(result.y).toBeLessThan(19.995);

    // It should be roughly centered (allowing some tolerance)
    const expectedCenter = (19.5 + 19.995) / 2; // ~19.7475
    expect(Math.abs(result.y - expectedCenter)).toBeLessThan(0.15);
  }
});

test("computeDrawPositionFromCollisions should not cross colliding segments", () => {
  const input = {
    cursorPosition: {
      x: 31.46,
      y: 3.159747470810159,
      z: 0,
    },
    lastCursorPosition: {
      x: 31.46,
      y: 2.659747470810159,
      z: 0,
    },
    collidingSegments: [
      // First rectangle (left obstacle)
      { start: { x: 29.19, y: 3.54 }, end: { x: 31.19, y: 3.54 } },
      { start: { x: 31.19, y: 3.54 }, end: { x: 31.19, y: 1.54 } },
      { start: { x: 31.19, y: 1.54 }, end: { x: 29.19, y: 1.54 } },
      { start: { x: 29.19, y: 1.54 }, end: { x: 29.19, y: 3.54 } },
      // Second rectangle (right obstacle)
      { start: { x: 31.73, y: 3.54 }, end: { x: 33.73, y: 3.54 } },
      { start: { x: 33.73, y: 3.54 }, end: { x: 33.73, y: 1.54 } },
      { start: { x: 33.73, y: 1.54 }, end: { x: 31.73, y: 1.54 } },
      { start: { x: 31.73, y: 1.54 }, end: { x: 31.73, y: 3.54 } },
    ],
    keepoutRadius: 0.5,
  };

  const result = computeDrawPositionFromCollisions(input);

  // The cursor is at x=31.46, in the gap between rectangles at x=31.19 and x=31.73
  // Gap width: 31.73 - 31.19 = 0.54
  // Gap center: (31.19 + 31.73) / 2 = 31.46 (cursor is already centered!)

  // The draw position should either be null (cursor is fine) or very close to cursor
  // It should NEVER cross a colliding segment (x should stay between 31.19 and 31.73)

  if (result) {
    // Draw position must stay within the gap
    expect(result.x).toBeGreaterThan(31.19);
    expect(result.x).toBeLessThan(31.73);

    // Check that no segment is crossed between cursor and draw position
    const segmentsCrossed = input.collidingSegments.filter((seg) => {
      // Simple line intersection check
      return segmentsIntersect(
        input.cursorPosition,
        result,
        seg.start,
        seg.end,
      );
    });
    expect(segmentsCrossed.length).toBe(0);
  }
});

// Helper function for segment intersection
function segmentsIntersect(
  a1: { x: number; y: number },
  a2: { x: number; y: number },
  b1: { x: number; y: number },
  b2: { x: number; y: number },
): boolean {
  const d1 = direction(b1, b2, a1);
  const d2 = direction(b1, b2, a2);
  const d3 = direction(a1, a2, b1);
  const d4 = direction(a1, a2, b2);

  if (
    ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
    ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
  ) {
    return true;
  }
  return false;
}

function direction(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
): number {
  return (c.x - a.x) * (b.y - a.y) - (b.x - a.x) * (c.y - a.y);
}
