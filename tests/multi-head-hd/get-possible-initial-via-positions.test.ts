import { test, expect } from "bun:test"
import { computeViaCountVariants } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/computeViaCountVariants"
import { getPossibleInitialViaPositions } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/getPossibleInitialViaPositions"
import { planUnbrokenPourEscapes } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/planUnbrokenPourEscapes"

test("getPossibleInitialViaPositions1", () => {
  const possiblePositions = getPossibleInitialViaPositions({
    bounds: {
      minX: 0,
      maxX: 10,
      minY: 0,
      maxY: 10,
    },
    portPairsEntries: [
      [
        "A",
        {
          start: { x: 0, y: 0, z1: 0, z2: 0 },
          end: { x: 10, y: 10, z1: 0, z2: 0 },
        },
      ],
      [
        "B",
        {
          start: { x: 0, y: 5, z1: 0, z2: 0 },
          end: { x: 10, y: 5, z1: 0, z2: 0 },
        },
      ],
    ],
    viaCountVariants: [
      [2, 0],
      [0, 2],
    ],
  })

  expect(possiblePositions).toMatchInlineSnapshot(`
    [
      {
        "viaCountVariant": [
          2,
          0,
        ],
        "viaPositions": [
          {
            "x": 3.888888888888889,
            "y": 7.777777777777778,
          },
          {
            "x": 8.333333333333334,
            "y": 6.666666666666667,
          },
        ],
      },
      {
        "viaCountVariant": [
          2,
          0,
        ],
        "viaPositions": [
          {
            "x": 6.111111111111111,
            "y": 2.2222222222222223,
          },
          {
            "x": 8.333333333333334,
            "y": 6.666666666666667,
          },
        ],
      },
      {
        "viaCountVariant": [
          2,
          0,
        ],
        "viaPositions": [
          {
            "x": 6.111111111111111,
            "y": 2.2222222222222223,
          },
          {
            "x": 3.888888888888889,
            "y": 7.777777777777778,
          },
        ],
      },
      {
        "viaCountVariant": [
          2,
          0,
        ],
        "viaPositions": [
          {
            "x": 1.6666666666666667,
            "y": 3.3333333333333335,
          },
          {
            "x": 8.333333333333334,
            "y": 6.666666666666667,
          },
        ],
      },
      {
        "viaCountVariant": [
          2,
          0,
        ],
        "viaPositions": [
          {
            "x": 1.6666666666666667,
            "y": 3.3333333333333335,
          },
          {
            "x": 3.888888888888889,
            "y": 7.777777777777778,
          },
        ],
      },
      {
        "viaCountVariant": [
          2,
          0,
        ],
        "viaPositions": [
          {
            "x": 1.6666666666666667,
            "y": 3.3333333333333335,
          },
          {
            "x": 6.111111111111111,
            "y": 2.2222222222222223,
          },
        ],
      },
      {
        "viaCountVariant": [
          0,
          2,
        ],
        "viaPositions": [
          {
            "x": 3.888888888888889,
            "y": 7.777777777777778,
          },
          {
            "x": 8.333333333333334,
            "y": 6.666666666666667,
          },
        ],
      },
      {
        "viaCountVariant": [
          0,
          2,
        ],
        "viaPositions": [
          {
            "x": 6.111111111111111,
            "y": 2.2222222222222223,
          },
          {
            "x": 8.333333333333334,
            "y": 6.666666666666667,
          },
        ],
      },
      {
        "viaCountVariant": [
          0,
          2,
        ],
        "viaPositions": [
          {
            "x": 6.111111111111111,
            "y": 2.2222222222222223,
          },
          {
            "x": 3.888888888888889,
            "y": 7.777777777777778,
          },
        ],
      },
      {
        "viaCountVariant": [
          0,
          2,
        ],
        "viaPositions": [
          {
            "x": 1.6666666666666667,
            "y": 3.3333333333333335,
          },
          {
            "x": 8.333333333333334,
            "y": 6.666666666666667,
          },
        ],
      },
      {
        "viaCountVariant": [
          0,
          2,
        ],
        "viaPositions": [
          {
            "x": 1.6666666666666667,
            "y": 3.3333333333333335,
          },
          {
            "x": 3.888888888888889,
            "y": 7.777777777777778,
          },
        ],
      },
      {
        "viaCountVariant": [
          0,
          2,
        ],
        "viaPositions": [
          {
            "x": 1.6666666666666667,
            "y": 3.3333333333333335,
          },
          {
            "x": 6.111111111111111,
            "y": 2.2222222222222223,
          },
        ],
      },
    ]
  `)
})

test("unbroken top pour reserves near-pad escape vias for same-layer routing", () => {
  const bounds = {
    minX: 0,
    maxX: 10,
    minY: 0,
    maxY: 10,
  }
  const portPairsEntries = [
    [
      "GND_ESCAPE",
      {
        start: { x: 0, y: 5, z1: 0, z2: 0 },
        end: { x: 10, y: 5, z1: 0, z2: 0 },
      },
    ],
  ] as const

  const escapePlan = planUnbrokenPourEscapes({
    portPairsEntries: [...portPairsEntries],
    bounds,
    availableZ: [0, 1],
    blockedLayers: [0],
    boundaryPadding: 0.05,
    viaDiameter: 0.3,
    traceWidth: 0.15,
  })

  expect(escapePlan.minimumViaCountPerConnection).toEqual([2])
  expect(escapePlan.reservedViaPositionsByConnectionName).toEqual({
    GND_ESCAPE: [
      { x: 1.8, y: 5 },
      { x: 8.2, y: 5 },
    ],
  })

  const viaCountVariants = computeViaCountVariants(
    [...portPairsEntries],
    3,
    3,
    0,
    escapePlan.minimumViaCountPerConnection,
  )

  expect(viaCountVariants).toEqual([[2]])

  const possiblePositions = getPossibleInitialViaPositions({
    bounds,
    portPairsEntries: [...portPairsEntries],
    viaCountVariants,
    reservedViaPositionsByConnectionName:
      escapePlan.reservedViaPositionsByConnectionName,
  })

  expect(possiblePositions).toEqual([
    {
      viaCountVariant: [2],
      viaPositions: [
        { x: 1.8, y: 5 },
        { x: 8.2, y: 5 },
      ],
    },
  ])
})
