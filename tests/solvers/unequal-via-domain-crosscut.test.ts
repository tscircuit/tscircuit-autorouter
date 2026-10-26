import { expect, test } from "bun:test"
import {
  doesUnequalViaDomainBlockCrossing,
  type UnequalViaDomainCrossingInput,
  type ViaDomainBounds,
} from "lib/solvers/PortPointPathingSolver/tinyhypergraph/doesUnequalViaDomainBlockCrossing"

function transformBounds(
  bounds: ViaDomainBounds,
  transform: (x: number, y: number) => [number, number],
): ViaDomainBounds {
  const points = [
    transform(bounds.minX, bounds.minY),
    transform(bounds.minX, bounds.maxY),
    transform(bounds.maxX, bounds.minY),
    transform(bounds.maxX, bounds.maxY),
  ]
  return {
    minX: Math.min(...points.map(([x]) => x)),
    maxX: Math.max(...points.map(([x]) => x)),
    minY: Math.min(...points.map(([, y]) => y)),
    maxY: Math.max(...points.map(([, y]) => y)),
  }
}

test("unequal via domains block movable crossing wires", (): void => {
  // Actual sample24 node61252 domains, translated to the cell's lower corner.
  // GND owns the pad limiting the two signal domains, so its domain is wider.
  const width = 0.533399519999989
  const height = 0.48590282000002105
  const signalWidth = 0.3506427
  const signalHeight = 0.33590283
  const signal = {
    minX: 0,
    maxX: signalWidth,
    minY: 0,
    maxY: signalHeight,
  }
  const input: UnequalViaDomainCrossingInput = {
    cellBounds: { minX: 0, maxX: width, minY: 0, maxY: height },
    mandatoryViaBounds: { ...signal },
    restrictedWireViaBounds: { ...signal },
    otherWireViaBounds: { ...signal, maxX: width },
    minimumForeignViaDistance: 0.399998,
    minimumSameOwnerDrillDistance: 0.249999,
    traceExclusionRadius: 0.29499,
    slack: 1e-8,
  }
  const original = structuredClone(input)
  expect(doesUnequalViaDomainBlockCrossing(input)).toBe(true)
  expect(
    doesUnequalViaDomainBlockCrossing({
      ...input,
      minimumForeignViaDistance: 0.399999,
      traceExclusionRadius: 0.295,
    }),
  ).toBe(true)
  for (const transform of [
    (x: number, y: number): [number, number] => [x, y],
    (x: number, y: number): [number, number] => [-x, y],
    (x: number, y: number): [number, number] => [x, -y],
    (x: number, y: number): [number, number] => [-x, -y],
    (x: number, y: number): [number, number] => [y, x],
    (x: number, y: number): [number, number] => [-y, x],
    (x: number, y: number): [number, number] => [y, -x],
    (x: number, y: number): [number, number] => [-y, -x],
  ]) {
    for (const [offsetX, offsetY] of [
      [0, 0],
      [279.29855748, 68.585798],
      [-1000000, 1000000],
    ]) {
      const move = (x: number, y: number): [number, number] => {
        const [nextX, nextY] = transform(x, y)
        return [nextX + offsetX!, nextY + offsetY!]
      }
      expect(
        doesUnequalViaDomainBlockCrossing({
          ...input,
          cellBounds: transformBounds(input.cellBounds, move),
          mandatoryViaBounds: transformBounds(input.mandatoryViaBounds, move),
          restrictedWireViaBounds: transformBounds(
            input.restrictedWireViaBounds,
            move,
          ),
          otherWireViaBounds: transformBounds(input.otherWireViaBounds, move),
        }),
      ).toBe(true)
    }
  }
  expect(
    doesUnequalViaDomainBlockCrossing({
      ...input,
      mandatoryViaBounds: {
        minX: 0.02,
        maxX: signalWidth - 0.02,
        minY: 0.01,
        maxY: signalHeight - 0.01,
      },
    }),
  ).toBe(true)
  expect(
    doesUnequalViaDomainBlockCrossing({
      ...input,
      otherWireViaBounds: { ...signal },
    }),
  ).toBe(true)
  expect(
    doesUnequalViaDomainBlockCrossing({
      ...input,
      minimumForeignViaDistance: 1,
    }),
  ).toBe(true)

  // Enlarging G permits two separated GND barrels while a mandatory signal
  // barrel at (0,0) remains outside both foreign-via exclusion discs.
  const firstWide = { x: width, y: 0 }
  const secondWide = { x: 0, y: height }
  expect(Math.hypot(firstWide.x, firstWide.y)).toBeGreaterThan(
    input.minimumForeignViaDistance,
  )
  expect(Math.hypot(secondWide.x, secondWide.y)).toBeGreaterThan(
    input.minimumForeignViaDistance,
  )
  expect(Math.hypot(width, height)).toBeGreaterThan(
    2 * input.traceExclusionRadius,
  )
  expect(
    doesUnequalViaDomainBlockCrossing({
      ...input,
      otherWireViaBounds: { ...input.cellBounds },
    }),
  ).toBe(false)

  // These two restricted barrels both satisfy the mandatory barrel's foreign
  // distance, but can coexist when the same-owner drill spacing is smaller.
  const dx = Math.sqrt(input.minimumForeignViaDistance ** 2 - signalHeight ** 2)
  const dy = Math.sqrt(input.minimumForeignViaDistance ** 2 - signalWidth ** 2)
  const cornerDiameter = Math.hypot(signalWidth - dx, signalHeight - dy)
  expect(Math.hypot(signalWidth, dy)).toBeCloseTo(
    input.minimumForeignViaDistance,
    12,
  )
  expect(Math.hypot(dx, signalHeight)).toBeCloseTo(
    input.minimumForeignViaDistance,
    12,
  )
  expect(cornerDiameter).toBeGreaterThan(0.19)
  expect(
    doesUnequalViaDomainBlockCrossing({
      ...input,
      minimumSameOwnerDrillDistance: 0.19,
    }),
  ).toBe(false)
  for (const delta of [-1e-9, 0, 1e-9]) {
    expect(
      doesUnequalViaDomainBlockCrossing({
        ...input,
        slack: 0,
        minimumSameOwnerDrillDistance: cornerDiameter + delta,
      }),
    ).toBe(delta > 0)
  }
  const quadrantThreshold = Math.sqrt(width ** 2 + (signalHeight / 2) ** 2)
  for (const delta of [-1e-7, 0, 1e-7]) {
    expect(
      doesUnequalViaDomainBlockCrossing({
        ...input,
        slack: 0,
        traceExclusionRadius: (quadrantThreshold + delta) / 2,
      }),
    ).toBe(delta > 0)
  }
  for (const change of [
    { minimumForeignViaDistance: 0.3 },
    { traceExclusionRadius: 0.15 },
    { slack: 0.1 },
    { mandatoryViaBounds: { ...signal, maxX: width } },
    { restrictedWireViaBounds: { ...signal, maxX: width } },
    { otherWireViaBounds: { ...signal, minX: 0.01 } },
    { mandatoryViaBounds: { ...signal, minX: -0.01 } },
    { mandatoryViaBounds: { ...signal, maxX: 0 } },
    { restrictedWireViaBounds: { ...signal, maxY: 0 } },
    { cellBounds: { ...input.cellBounds, maxX: Number.POSITIVE_INFINITY } },
    { minimumForeignViaDistance: Number.NaN },
    { minimumForeignViaDistance: 0 },
    { minimumSameOwnerDrillDistance: 0 },
    { traceExclusionRadius: 0 },
    { slack: -1 },
  ]) {
    expect(doesUnequalViaDomainBlockCrossing({ ...input, ...change })).toBe(
      false,
    )
  }
  expect(input).toEqual(original)
})
