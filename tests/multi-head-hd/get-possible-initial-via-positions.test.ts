import { test, expect } from "bun:test";
import { getPossibleInitialViaPositions } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/getPossibleInitialViaPositions";

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
  });

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
  `);
});
