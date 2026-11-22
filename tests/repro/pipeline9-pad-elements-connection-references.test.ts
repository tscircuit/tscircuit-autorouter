import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { createPcbPadElements } from "lib/utils/convertToCircuitJson"
import type { SimpleRouteJson } from "lib/types"

test("H616 pad elements read each connection's references once", (): void => {
  const { inputSrj } = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/assets/h616-native-ddr-clearance.srj.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString("utf8"),
  ) as { inputSrj: SimpleRouteJson }
  let referenceReads = 0
  const connections = inputSrj.connections.map((connection) => {
    const rootConnectionNames = connection.__rootConnectionNames
    return Object.defineProperty({ ...connection }, "__rootConnectionNames", {
      get: (): string[] | undefined => {
        referenceReads += 1
        return rootConnectionNames
      },
    })
  })
  const padElements = createPcbPadElements({ ...inputSrj, connections })
  expect(padElements.length).toBeGreaterThan(0)

  const svg = `<svg width="480" height="60" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/><text x="24" y="38" font-family="Arial, sans-serif" font-size="20" fill="#166534">Connection reference reads: ${referenceReads}</text></svg>`
  expect(svg).toMatchSvgSnapshot(import.meta.path)
})
