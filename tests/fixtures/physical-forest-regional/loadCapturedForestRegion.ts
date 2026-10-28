import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import type { Pipeline9HighDensitySolverParams } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"

type CapturedForestRegion = Omit<Pipeline9HighDensitySolverParams, "connMap"> & {
  connectivityNetMap: Record<string, string[]>
}

const capturedRegionMetadata = {
  "cmn_42": {
    "uncompressedBytes": 104298,
    "uncompressedSha256": "3762a5269614607c3eb87aae1959fdffe8e0c3da99509140cb74e00e8ffa2cbf",
    "compressedBytes": 7269,
    "compressedSha256": "d3792580da837b9b4506f6454d99160480d7cddf1787c8eadcb3af4fee65b027"
  },
  "cmn_57": {
    "uncompressedBytes": 104624,
    "uncompressedSha256": "34de944b19a49ed56b46bea8dd7ad9054d51ad65a76ad672c616cc989857c70b",
    "compressedBytes": 7346,
    "compressedSha256": "48db5c85c25efd65f515017f3a67759fca5774ae2e8b0a6d307c2ec95e290118"
  }
} as const

/** Verify the exact captured input before any routing or test preprocessing. */
export function loadCapturedForestRegion(name: keyof typeof capturedRegionMetadata): CapturedForestRegion {
  const metadata = capturedRegionMetadata[name]
  const compressed = new Uint8Array(readFileSync(new URL(`./${name}.json.gz`, import.meta.url)))
  assert.equal(compressed.length, metadata.compressedBytes, `${name}: compressed size`)
  assert.equal(createHash("sha256").update(compressed).digest("hex"), metadata.compressedSha256,
    `${name}: compressed SHA-256`)
  const original = gunzipSync(compressed)
  assert.equal(original.length, metadata.uncompressedBytes, `${name}: original size`)
  assert.equal(createHash("sha256").update(new Uint8Array(original)).digest("hex"), metadata.uncompressedSha256,
    `${name}: exact captured input SHA-256`)
  return JSON.parse(original.toString("utf8")) as CapturedForestRegion
}
