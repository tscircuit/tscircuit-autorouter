import {
  ViaPossibility,
  PortPair,
  ViaPlacement,
  Point3,
} from "./getViaPossibilities"
import { distance } from "@tscircuit/math-utils"

export function getViaCombinations(
  candidatesByConn: Map<string, ViaPossibility[]>,
  portPairs: Map<string, { start: Point3; end: Point3 }>,
  maxViaCount: number,
  minViaCount: number = 0,
): ViaPlacement[][] {
  // 1) build per‐connection option lists
  const optsByConn = new Map<string, ViaPlacement[][]>()

  for (const [conn, { start, end }] of portPairs.entries()) {
    const cands = candidatesByConn.get(conn) || []
    const sameZ = start.z === end.z
    const opts: ViaPlacement[][] = []

    if (sameZ) {
      // even or zero
      opts.push([]) // zero vias
      if (cands.length >= 2) {
        // pick exactly two (closest two)
        const two = cands
          .slice(0, 2)
          .map((vp) => ({ x: vp.x, y: vp.y, connectionName: conn }))
        opts.push(two)
      }
    } else {
      // odd and at least one
      // one‐via choices
      for (const vp of cands) {
        opts.push([{ x: vp.x, y: vp.y, connectionName: conn }])
      }
      // if you ever want 3-via (and have ≥3), do same …
    }

    optsByConn.set(conn, opts)
  }

  // 2) Cartesian product of all those per-conn lists
  const allOpts = Array.from(optsByConn.values())
  console.log({ allOpts })
  /*
  {
      "allOpts": [
          [
              [],
              [
                  {
                      "x": -138.53689236111111,
                      "y": 24.40212673611111,
                      "connectionName": "source_trace_16"
                  },
                  {
                      "x": -139.13411458333334,
                      "y": 23.655598958333332,
                      "connectionName": "source_trace_16"
                  }
              ]
          ],
          [],
          [
              [],
              [
                  {
                      "x": -138.59068627450577,
                      "y": 24.89752476511367,
                      "connectionName": "source_net_1_mst26"
                  },
                  {
                      "x": -138.56518817204523,
                      "y": 24.058212225582707,
                      "connectionName": "source_net_1_mst26"
                  }
              ]
          ]
      ]
  }
  */
  let combos: ViaPlacement[][] = [[]]

  for (const connOpts of allOpts) {
    const newCombos: ViaPlacement[][] = []
    for (const base of combos) {
      for (const picks of connOpts) {
        newCombos.push(base.concat(picks))
      }
    }
    combos = newCombos
  }

  console.log({ combos })
  /*
  {
      "combos": []
  }
  */

  // 3) final size‐filter
  return combos.filter(
    (c) => c.length >= minViaCount && c.length <= maxViaCount,
  )
}
