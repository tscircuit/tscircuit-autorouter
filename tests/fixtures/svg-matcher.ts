import { expect, type MatcherResult } from "bun:test"
import * as fs from "node:fs"
import * as path from "node:path"
import looksSame from "looks-same"
import { Resvg } from "@resvg/resvg-js"

// Convert SVGs to high-resolution PNGs for comparison
function svgToPngBuffer(svg: string, scale: number = 4): Buffer {
  const resvg = new Resvg(svg, {
    fitTo: {
      mode: "zoom",
      value: scale,
    },
    background: "black",
  })
  return resvg.render().asPng()
}

type SvgSnapshotOpts = {
  svgName?: string
  scale?: number
  tolerance?: number // e.g. 0.05 for 5%
}

/**
 * Matcher for SVG snapshot testing with cross-platform tolerance.
 *
 * Usage:
 *   expect(svgString).toMatchSvgSnapshot(import.meta.path, { svgName: "optionalName" });
 */
async function toMatchSvgSnapshot(
  // biome-ignore lint/suspicious/noExplicitAny: bun doesn't expose
  this: any,
  receivedMaybePromise: string | Promise<string>,
  testPathOriginal: string,
  opts: SvgSnapshotOpts = {},
): Promise<MatcherResult> {
  const { svgName, scale = 4, tolerance: tolerancePercent = 0.01 } = opts
  const received = await receivedMaybePromise
  const testPath = testPathOriginal
    .replace(/\.test\.tsx?$/, "")
    .replace(/\.test\.ts$/, "")
  const snapshotDir = path.join(path.dirname(testPath), "__snapshots__")
  const snapshotName = svgName
    ? `${path.basename(testPath)}-${svgName}.snap.svg`
    : `${path.basename(testPath)}.snap.svg`
  const filePath = path.join(snapshotDir, snapshotName)

  if (!fs.existsSync(snapshotDir)) {
    fs.mkdirSync(snapshotDir, { recursive: true })
  }

  const updateSnapshot =
    process.argv.includes("--update-snapshots") ||
    process.argv.includes("-u") ||
    Boolean(process.env["BUN_UPDATE_SNAPSHOTS"])
  const forceUpdate = Boolean(process.env["FORCE_BUN_UPDATE_SNAPSHOTS"])

  const fileExists = fs.existsSync(filePath)

  if (!fileExists) {
    console.log("Writing SVG snapshot to", filePath)
    fs.writeFileSync(filePath, received)
    return {
      message: () => `SVG snapshot created at ${filePath}`,
      pass: true,
    }
  }

  const existingSnapshot = fs.readFileSync(filePath, "utf-8")

  // Render SVGs to PNG buffers for pixel comparison
  const receivedPng = svgToPngBuffer(received, scale)
  const existingPng = svgToPngBuffer(existingSnapshot, scale)

  const result: any = await looksSame(receivedPng, existingPng, {
    strict: false,
    tolerance: 5,
    antialiasingTolerance: 4,
    ignoreCaret: true,
    shouldCluster: true,
    clustersSize: 10,
  })

  if (updateSnapshot) {
    if (!forceUpdate && result.equal) {
      return {
        message: () => "SVG snapshot matches",
        pass: true,
      }
    }
    console.log("Updating SVG snapshot at", filePath)
    fs.writeFileSync(filePath, received)
    return {
      message: () => `SVG snapshot updated at ${filePath}`,
      pass: true,
    }
  }

  if (result.equal) {
    return {
      message: () => "SVG snapshot matches",
      pass: true,
    }
  }

  // Calculate diff percentage for cross-platform tolerance
  if (result.diffBounds) {
    // Get image dimensions from the PNG buffer
    const width = existingPng.readUInt32BE(16)
    const height = existingPng.readUInt32BE(20)
    const totalPixels = width * height

    const diffArea =
      (result.diffBounds.right - result.diffBounds.left) *
      (result.diffBounds.bottom - result.diffBounds.top)
    const diffPercentage = (diffArea / totalPixels) * 100

    // Allow up to tolerancePercent (default 5%) pixel difference for cross-platform rendering variations
    const ACCEPTABLE_DIFF_PERCENTAGE =
      (typeof tolerancePercent === "number" ? tolerancePercent : 0.05) * 100

    if (diffPercentage <= ACCEPTABLE_DIFF_PERCENTAGE) {
      console.log(
        `✓ SVG snapshot matches (${diffPercentage.toFixed(3)}% difference, within ${ACCEPTABLE_DIFF_PERCENTAGE}% threshold)`,
      )
      return {
        message: () =>
          `SVG snapshot matches (${diffPercentage.toFixed(3)}% difference)`,
        pass: true,
      }
    }

    // If difference is too large, create diff image
    const diffPath = filePath.replace(/\.snap\.svg$/, ".diff.png")
    await looksSame.createDiff({
      reference: existingPng,
      current: receivedPng,
      diff: diffPath,
      highlightColor: "#ff00ff",
    })

    return {
      message: () =>
        `SVG snapshot differs by ${diffPercentage.toFixed(3)}% (threshold: ${ACCEPTABLE_DIFF_PERCENTAGE}%). Diff saved at ${diffPath}. Use BUN_UPDATE_SNAPSHOTS=1 to update the snapshot.`,
      pass: false,
    }
  }

  // Fallback if diffBounds isn't available
  const diffPath = filePath.replace(/\.snap\.svg$/, ".diff.png")
  await looksSame.createDiff({
    reference: existingPng,
    current: receivedPng,
    diff: diffPath,
    highlightColor: "#ff00ff",
  })

  console.log(`📸 SVG snapshot mismatch (no diff bounds available)`)
  console.log(`   Diff saved: ${diffPath}`)

  return {
    message: () => `SVG snapshot does not match. Diff saved at ${diffPath}`,
    pass: false,
  }
}

// Register the matcher globally for Bun's expect
expect.extend({
  toMatchSvgSnapshot: toMatchSvgSnapshot as any,
})

declare module "bun:test" {
  interface Matchers<T = unknown> {
    toMatchSvgSnapshot(
      testPath: string,
      opts?: {
        svgName?: string
        scale?: number
        tolerance?: number
      },
    ): Promise<MatcherResult>
  }
}
