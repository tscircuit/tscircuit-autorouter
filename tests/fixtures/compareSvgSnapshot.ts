import { Resvg } from "@resvg/resvg-js"
import looksSame from "looks-same"

type SvgSnapshotComparison = {
  equal: boolean
  matches: boolean
  diffPercentage: number
  diffImage: looksSame.DiffImage | null
}

export async function compareSvgSnapshot(
  received: string,
  expected: string,
  { scale = 4, tolerance = 0.01 }: { scale?: number; tolerance?: number } = {},
): Promise<SvgSnapshotComparison> {
  const renderOptions = {
    fitTo: { mode: "zoom" as const, value: scale },
    background: "black",
  }
  const receivedPng = new Resvg(received, renderOptions).render().asPng()
  const expectedPng = new Resvg(expected, renderOptions).render().asPng()
  const comparisonOptions = {
    strict: false,
    tolerance: 5,
    antialiasingTolerance: 4,
    ignoreCaret: true,
    shouldCluster: true,
    clustersSize: 10,
    createDiffImage: true as const,
    highlightColor: "#ff00ff",
  }
  const result = await looksSame(receivedPng, expectedPng, comparisonOptions)
  const diffPercentage = result.equal
    ? 0
    : (result.differentPixels / result.totalPixels) * 100
  return {
    equal: result.equal,
    matches: result.equal || diffPercentage <= tolerance * 100,
    diffPercentage,
    diffImage: result.diffImage,
  }
}
