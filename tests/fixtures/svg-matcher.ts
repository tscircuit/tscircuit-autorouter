import { expect, type MatcherResult } from "bun:test"
import * as fs from "node:fs"
import * as path from "node:path"
import { compareSvgSnapshot } from "./compareSvgSnapshot"

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

  const comparison = await compareSvgSnapshot(received, existingSnapshot, {
    scale,
    tolerance: tolerancePercent,
  })

  if (updateSnapshot) {
    if (!forceUpdate && comparison.equal) {
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

  if (comparison.matches) {
    if (!comparison.equal) {
      console.log(
        `✓ SVG snapshot matches (${comparison.diffPercentage.toFixed(3)}% difference, within ${tolerancePercent * 100}% threshold)`,
      )
    }
    return {
      message: () => "SVG snapshot matches",
      pass: true,
    }
  }

  const diffPath = filePath.replace(/\.snap\.svg$/, ".diff.png")
  const receivedPath = filePath.replace(/\.snap\.svg$/, ".received.svg")
  fs.writeFileSync(receivedPath, received)
  if (comparison.diffImage === null) {
    throw new Error("SVG comparison did not return its difference image")
  }
  await comparison.diffImage.save(diffPath)
  return {
    message: () =>
      `SVG snapshot differs by ${comparison.diffPercentage.toFixed(3)}% (threshold: ${tolerancePercent * 100}%). Diff saved at ${diffPath}. Use BUN_UPDATE_SNAPSHOTS=1 to update the snapshot.`,
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
