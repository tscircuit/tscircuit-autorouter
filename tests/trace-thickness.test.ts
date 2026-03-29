import { describe, it, expect } from "vitest"
import {
  TRACE_BASE_WIDTH_MM,
  resolveTraceWidth,
  nearestSupportedMultiple,
  traceHalfWidth,
} from "../lib/types/trace-thickness"
import {
  effectiveObstacleRadius,
  minCentreDistance,
  recommendedGridStep,
  areTracesAdjacent,
  DEFAULT_MIN_CLEARANCE_MM,
} from "../lib/utils/trace-width"

// ─── resolveTraceWidth ──────────────────────────────────────────────────────

describe("resolveTraceWidth", () => {
  it("returns base width when called with no args", () => {
    expect(resolveTraceWidth()).toBeCloseTo(TRACE_BASE_WIDTH_MM)
  })

  it("returns base width for null / undefined", () => {
    expect(resolveTraceWidth(null)).toBeCloseTo(TRACE_BASE_WIDTH_MM)
    expect(resolveTraceWidth(undefined)).toBeCloseTo(TRACE_BASE_WIDTH_MM)
  })

  it("returns the numeric value when passed a positive number", () => {
    expect(resolveTraceWidth(0.3)).toBeCloseTo(0.3)
    expect(resolveTraceWidth(0.6)).toBeCloseTo(0.6)
    expect(resolveTraceWidth(1.2)).toBeCloseTo(1.2)
  })

  it("falls back to base width when passed 0 or negative", () => {
    expect(resolveTraceWidth(0)).toBeCloseTo(TRACE_BASE_WIDTH_MM)
    expect(resolveTraceWidth(-1)).toBeCloseTo(TRACE_BASE_WIDTH_MM)
  })

  it("resolves widthMm from a config object", () => {
    expect(resolveTraceWidth({ widthMm: 0.6 })).toBeCloseTo(0.6)
  })

  it("resolves widthMultiple from a config object", () => {
    expect(resolveTraceWidth({ widthMultiple: 1 })).toBeCloseTo(0.15)
    expect(resolveTraceWidth({ widthMultiple: 2 })).toBeCloseTo(0.30)
    expect(resolveTraceWidth({ widthMultiple: 4 })).toBeCloseTo(0.60)
    expect(resolveTraceWidth({ widthMultiple: 8 })).toBeCloseTo(1.20)
  })

  it("widthMm takes precedence over widthMultiple", () => {
    expect(
      resolveTraceWidth({ widthMm: 0.9, widthMultiple: 2 }),
    ).toBeCloseTo(0.9)
  })

  it("falls back to base width for empty config object", () => {
    expect(resolveTraceWidth({})).toBeCloseTo(TRACE_BASE_WIDTH_MM)
  })
})

// ─── nearestSupportedMultiple ───────────────────────────────────────────────

describe("nearestSupportedMultiple", () => {
  it("returns 1 for base width", () => {
    expect(nearestSupportedMultiple(0.15)).toBe(1)
  })

  it("rounds up to the next multiple when between steps", () => {
    expect(nearestSupportedMultiple(0.16)).toBe(2)
    expect(nearestSupportedMultiple(0.29)).toBe(2)
  })

  it("returns 2 for exactly 0.30 mm", () => {
    expect(nearestSupportedMultiple(0.30)).toBe(2)
  })

  it("returns 4 for exactly 0.60 mm", () => {
    expect(nearestSupportedMultiple(0.60)).toBe(4)
  })

  it("returns 8 for exactly 1.20 mm", () => {
    expect(nearestSupportedMultiple(1.20)).toBe(8)
  })

  it("clamps at 8 for values beyond 1.20 mm", () => {
    expect(nearestSupportedMultiple(2.0)).toBe(8)
  })
})

// ─── traceHalfWidth ─────────────────────────────────────────────────────────

describe("traceHalfWidth", () => {
  it("returns half the width", () => {
    expect(traceHalfWidth(0.30)).toBeCloseTo(0.15)
    expect(traceHalfWidth(0.60)).toBeCloseTo(0.30)
    expect(traceHalfWidth(1.20)).toBeCloseTo(0.60)
  })
})

// ─── effectiveObstacleRadius ────────────────────────────────────────────────

describe("effectiveObstacleRadius", () => {
  it("equals halfWidth + clearance for standard trace", () => {
    // 0.15/2 + 0.15 = 0.075 + 0.15 = 0.225
    expect(
      effectiveObstacleRadius(TRACE_BASE_WIDTH_MM, DEFAULT_MIN_CLEARANCE_MM),
    ).toBeCloseTo(0.225)
  })

  it("scales correctly for a 2× trace (0.30 mm)", () => {
    // 0.30/2 + 0.15 = 0.15 + 0.15 = 0.30
    expect(effectiveObstacleRadius(0.30, DEFAULT_MIN_CLEARANCE_MM)).toBeCloseTo(0.30)
  })

  it("scales correctly for a 4× trace (0.60 mm)", () => {
    // 0.60/2 + 0.15 = 0.30 + 0.15 = 0.45
    expect(effectiveObstacleRadius(0.60, DEFAULT_MIN_CLEARANCE_MM)).toBeCloseTo(0.45)
  })

  it("scales correctly for an 8× trace (1.20 mm)", () => {
    // 1.20/2 + 0.15 = 0.60 + 0.15 = 0.75
    expect(effectiveObstacleRadius(1.20, DEFAULT_MIN_CLEARANCE_MM)).toBeCloseTo(0.75)
  })
})

// ─── minCentreDistance ──────────────────────────────────────────────────────

describe("minCentreDistance", () => {
  it("two standard traces need at least 0.30 mm centre-to-centre", () => {
    // 0.075 + 0.075 + 0.15 = 0.30
    expect(
      minCentreDistance(
        TRACE_BASE_WIDTH_MM,
        TRACE_BASE_WIDTH_MM,
        DEFAULT_MIN_CLEARANCE_MM,
      ),
    ).toBeCloseTo(0.30)
  })

  it("mixing a 1× and 2× trace", () => {
    // 0.075 + 0.15 + 0.15 = 0.375
    expect(
      minCentreDistance(0.15, 0.30, DEFAULT_MIN_CLEARANCE_MM),
    ).toBeCloseTo(0.375)
  })
})

// ─── recommendedGridStep ────────────────────────────────────────────────────

describe("recommendedGridStep", () => {
  it("standard trace → 0.30 mm grid step", () => {
    // 0.15 + 0.15 = 0.30, round up to nearest 0.05 → 0.30
    expect(
      recommendedGridStep(TRACE_BASE_WIDTH_MM, DEFAULT_MIN_CLEARANCE_MM),
    ).toBeCloseTo(0.30)
  })

  it("2× trace → 0.45 mm grid step", () => {
    // 0.30 + 0.15 = 0.45
    expect(recommendedGridStep(0.30, DEFAULT_MIN_CLEARANCE_MM)).toBeCloseTo(0.45)
  })

  it("4× trace → 0.75 mm grid step", () => {
    // 0.60 + 0.15 = 0.75
    expect(recommendedGridStep(0.60, DEFAULT_MIN_CLEARANCE_MM)).toBeCloseTo(0.75)
  })

  it("8× trace → 1.35 mm grid step", () => {
    // 1.20 + 0.15 = 1.35
    expect(recommendedGridStep(1.20, DEFAULT_MIN_CLEARANCE_MM)).toBeCloseTo(1.35)
  })
})

// ─── areTracesAdjacent ──────────────────────────────────────────────────────

describe("areTracesAdjacent", () => {
  it("overlapping centres → adjacent", () => {
    expect(areTracesAdjacent(0, 0.1, 0.15, 0.15)).toBe(true)
  })

  it("centres exactly at copper-edge distance → adjacent (within threshold)", () => {
    // halfWidth(0.15) + halfWidth(0.15) = 0.15
    expect(areTracesAdjacent(0, 0.15, 0.15, 0.15, 0.01)).toBe(true)
  })

  it("centres far apart → not adjacent", () => {
    expect(areTracesAdjacent(0, 1.0, 0.15, 0.15, 0.01)).toBe(false)
  })
})
