import { createHash } from "node:crypto"

const ALLOWED_INPUTS = new Map([
  ["cdd8fd63614327e7037617f62c0cc732861be5e969e53bdb99c0b0831e493fd1", "published_core2392"],
  ["76197e17b2d765dda6f5b354b477f7e0d82e5cff729c8768811b49fd9a6956a9", "published_core2392_with_frozen_v2_observer"],
])

/** Creates a private candidate, retaining all published exports and budgets. */
export function applyViaPourAntipadContract(source) {
  const inputSha256 = createHash("sha256").update(source).digest("hex")
  const inputVariant = ALLOWED_INPUTS.get(inputSha256)
  if (!inputVariant) throw new Error("Unexpected Core2392 input bytes")
  const original = source
  const anchors = []
  const once = (text, from, to, label) => {
    if (text.split(from).length !== 2) throw new Error(`Nonunique antipad contract anchor: ${label}`)
    anchors.push(label)
    return text.replace(from, to)
  }
  const edit = (start, end, transform) => {
    const a = source.indexOf(start), b = source.indexOf(end, a + start.length)
    if (a < 0 || b < 0) throw new Error(`Missing antipad contract region: ${start}`)
    source = source.slice(0, a) + transform(source.slice(a, b)) + source.slice(b)
  }

  edit("function fixedCopper(input) {", "function routeCopper", block => {
    block = once(block,
      "          owners: o2.connectedTo,\n          rect: bounds,",
      "          owners: o2.connectedTo,\n          isCopperPour: o2.isCopperPour,\n          rect: bounds,",
      "rotated pour primitive metadata")
    block = once(block,
      '        owners: o2.connectedTo,\n        rect: o2.shape === "circle"',
      '        owners: o2.connectedTo,\n        isCopperPour: o2.isCopperPour,\n        rect: o2.shape === "circle"',
      "ordinary pour primitive metadata")
    return once(block,
      "            radius: (p2.via_diameter ?? 0.3) / 2,\n            layer,\n            owners",
      `            radius: (p2.via_diameter ?? 0.3) / 2,
            layer,
            canFormAntipad: layer !== p2.from_layer && layer !== p2.to_layer,
            owners`,
      "manufactured via non-handoff layer metadata")
  })

  edit("var CopperConflictIndex = class", "function nativeLengthWindows", block => once(block,
    "        const d2 = second[j2], bj = j2 * 4;\n        if (c2.layer !== d2.layer",
    `        const d2 = second[j2], bj = j2 * 4;
        if (c2.isCopperPour && d2.canFormAntipad || d2.isCopperPour && c2.canFormAntipad)
          continue;
        if (c2.layer !== d2.layer`,
    "symmetric intermediate via-pour conflict exemption"))

  edit("function* expandedSignalSites({", "function ", block => {
    block = once(block,
      "    const viaScenes = physical.map(",
      `    // Only non-handoff pour layers form antipads around the barrel.
    // Surface/carrier routing and all physical copper retain their fixed list.
    const viaFixed = fixed.filter((copper) => !copper.isCopperPour || copper.layer === pad.layer || copper.layer === targetLayer2);
    const viaScenes = physical.map(`,
      "via-only source-and-target pour retention")
    return once(block,
      "        diameter,\n        fixed\n      )\n    );",
      "        diameter,\n        viaFixed\n      )\n    );",
      "viaScenes uses filtered primitive list")
  })

  const changedFunctions = [
    "fixedCopper: preserve pour provenance and mark actual via copper layers",
    "CopperConflictIndex.findConflict: skip only pour versus eligible via",
    "expandedSignalSites: via-only intermediate-pour exemption",
  ]
  return {
    source,
    proof: {
      inputVariant,
      inputSha256,
      outputSha256: createHash("sha256").update(source).digest("hex"),
      inputByteLength: Buffer.byteLength(original),
      outputByteLength: Buffer.byteLength(source),
      anchors,
      changedFunctions,
      carrierAndSurfaceFixedListsUnchanged: true,
      allNonPourObstaclesAndInputTracesRetained: true,
      sourceAndTargetPourPartsRetained: true,
      actualViaPhysicalSpanUnchanged: true,
      algorithmOptionsAndBudgetsChanged: false,
      v2ObserverFilesModified: false,
      requiresFinalManufacturedPourQualification: true,
    },
  }
}
