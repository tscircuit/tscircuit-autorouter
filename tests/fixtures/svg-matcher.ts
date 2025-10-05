import { expect, type MatcherResult } from "bun:test"
import * as fs from "node:fs"
import * as path from "node:path"
import looksSame from "looks-same"
import { Resvg } from "@resvg/resvg-js"

// Convert SVGs to high-resolution PNGs for comparison
// We'll use @resvg/resvg-js to render SVG to PNG at 4x scale for better diffing

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
  tolerancePercent?: number // e.g. 0.05 for 5%
}

async function toMatchSvgSnapshot(
  // biome-ignore lint/suspicious/noExplicitAny: bun doesn't expose
  this: any,
  receivedMaybePromise: string | Promise<string>,
  testPathOriginal: string,
  opts: SvgSnapshotOpts = {},
): Promise<MatcherResult> {
  const { svgName, scale = 4, tolerancePercent = 0.05 } = opts
  const received = await receivedMaybePromise
  const testPath = testPathOriginal.replace(/\.test\.tsx?$/, "")
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
    Boolean(process.env.BUN_UPDATE_SNAPSHOTS)
  const forceUpdate = Boolean(process.env.FORCE_BUN_UPDATE_SNAPSHOTS)

  const fileExists = fs.existsSync(filePath)

  if (!fileExists) {
    console.log("Writing snapshot to", filePath)
    fs.writeFileSync(filePath, received)
    return {
      message: () => `Snapshot created at ${filePath}`,
      pass: true,
    }
  }

  const existingSnapshot = fs.readFileSync(filePath, "utf-8")

  const receivedPng = svgToPngBuffer(received, scale)
  const existingPng = svgToPngBuffer(existingSnapshot, scale)

  const result: any = await looksSame(receivedPng, existingPng, {
    tolerance: 2,
    antialiasingTolerance: 2,
    strict: false,
  })

  // If images are not exactly equal, check if the difference is within the allowed tolerance
  let pass = result.equal
  let diffMessage = ""
  if (
    !result.equal &&
    typeof result.differentPixels === "number" &&
    typeof result.totalPixels === "number"
  ) {
    const percentDiff = result.differentPixels / result.totalPixels
    if (percentDiff <= tolerancePercent) {
      pass = true
      diffMessage = `Images differ by ${(percentDiff * 100).toFixed(2)}% (allowed: ${(tolerancePercent * 100).toFixed(2)}%)`
    } else {
      diffMessage = `Images differ by ${(percentDiff * 100).toFixed(2)}% (allowed: ${(tolerancePercent * 100).toFixed(2)}%)`
    }
  }

  if (updateSnapshot) {
    if (!forceUpdate && pass) {
      return {
        message: () =>
          diffMessage
            ? `Snapshot matches within tolerance. ${diffMessage}`
            : "Snapshot matches",
        pass: true,
      }
    }
    console.log("Updating snapshot at", filePath)
    fs.writeFileSync(filePath, received)
    return {
      message: () => `Snapshot updated at ${filePath}`,
      pass: true,
    }
  }

  if (pass) {
    return {
      message: () =>
        diffMessage
          ? `Snapshot matches within tolerance. ${diffMessage}`
          : "Snapshot matches",
      pass: true,
    }
  }

  const diffPath = filePath.replace(".snap.svg", ".diff.png")
  await looksSame.createDiff({
    reference: existingPng,
    current: receivedPng,
    diff: diffPath,
    highlightColor: "#ff00ff",
  })

  return {
    message: () =>
      `Snapshot does not match. Diff saved at ${diffPath}.` +
      (diffMessage ? ` ${diffMessage}` : ""),
    pass: false,
  }
}

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
        tolerancePercent?: number
      },
    ): Promise<MatcherResult>
  }
}
