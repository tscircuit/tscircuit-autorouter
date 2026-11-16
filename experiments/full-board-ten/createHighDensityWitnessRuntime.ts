import { createHash } from "node:crypto"
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { dirname, join, resolve } from "node:path"
import { createHighDensityWitnessPatchedEntry } from "./installHighDensityWitnessHooks"

type FileIdentity = { path: string; sha256: string }
type PackageIdentity = {
  name: string
  label: string
  version: string
  entry: string
  entryRelative: string
  entrySha256: string
  publishedFiles: Array<{ path: string; sha256: string }>
}
type WitnessRuntimeProof = {
  mainVersion: string
  casePath: string
  caseSha256: string
  manifestPath: string
  originalEntry: string
  originalEntrySha256: string
  observedEntry: string
  observedEntrySha256: string
  originalAlias: { path: string; target: string }
  assessmentAutorouterAlias: { path: string; target: string }
  privateFolder: string
  immutableFiles: FileIdentity[]
  privateFiles: FileIdentity[]
  originalPackages: PackageIdentity[]
  anchors: ReturnType<typeof createHighDensityWitnessPatchedEntry>["anchors"]
  observationalSourceOverride: true
  routingPolicyOverride: false
  neutralHelperPreparedBeforeOverride: true
  originalAutorouterRestoredBeforeAssessment: boolean
}

const originalAutorouterSha256 = "f5b61e425777bf4bceae861464583b8aa32db01439ce99c817b832adb39a5716"
const observedAutorouterSha256 = "dd279d2d53c6fc4ef1af38e3cb2979b39f19bca921b6abcbb0807847453d6f0b"

function digest(value: string | Uint8Array): string {
  const checksum = createHash("sha256")
  checksum.update(value)
  const hexadecimal = checksum.digest("hex")
  return hexadecimal
}

export function verifyHighDensityWitnessRuntime(
  proofPath: string,
  casePath: string,
  installed: boolean,
): WitnessRuntimeProof {
  const proof: WitnessRuntimeProof = JSON.parse(readFileSync(proofPath, "utf8"))
  if (proof.mainVersion !== "0.0.3207" || proof.casePath !== resolve(casePath) || digest(readFileSync(casePath)) !== proof.caseSha256) {
    throw new Error("HD witness case identity changed")
  }
  if (proof.originalEntrySha256 !== originalAutorouterSha256 || !proof.observationalSourceOverride || proof.routingPolicyOverride !== false) {
    throw new Error("HD witness must only observe the frozen published autorouter")
  }
  for (const file of [...proof.immutableFiles, ...proof.privateFiles]) {
    if (digest(readFileSync(file.path)) !== file.sha256) throw new Error(`HD witness file changed: ${file.path}`)
  }
  const patched = createHighDensityWitnessPatchedEntry(readFileSync(proof.originalEntry, "utf8"))
  if (proof.observedEntrySha256 !== observedAutorouterSha256 || digest(patched.source) !== proof.observedEntrySha256 || digest(readFileSync(proof.observedEntry)) !== proof.observedEntrySha256) {
    throw new Error("HD witness entry differs from the exact guarded observer patch")
  }
  const expectedAlias = installed ? proof.privateFolder : proof.originalAlias.target
  if (!lstatSync(proof.originalAlias.path).isSymbolicLink() || realpathSync(proof.originalAlias.path) !== expectedAlias) {
    throw new Error("HD witness autorouter alias changed")
  }
  if (!lstatSync(proof.assessmentAutorouterAlias.path).isSymbolicLink() || realpathSync(proof.assessmentAutorouterAlias.path) !== proof.originalAlias.target) {
    throw new Error("Neutral assessment helper must resolve the original autorouter directly")
  }
  const root = dirname(proof.manifestPath)
  for (const pkg of proof.originalPackages) {
    const expected = installed && pkg.name === "@tscircuit/capacity-autorouter" ? proof.privateFolder : join(root, "npm", pkg.label)
    if (realpathSync(join(root, "runtime/node_modules", pkg.name)) !== expected) throw new Error(`HD witness package alias changed: ${pkg.name}`)
  }
  return proof
}

export function createHighDensityWitnessRuntime(
  casePath: string,
  output: string,
): { proofPath: string; restore: () => void } {
  const task = JSON.parse(readFileSync(casePath, "utf8"))
  if (task.id !== "icepi" || task.cohort !== "spaced" || task.mode !== "phased" || task.fanout !== false || task.planes !== false) {
    throw new Error("HD witness is restricted to the authentic spaced iCE/Pi case")
  }
  if (task.captureDeadlineMs !== 900000 || task.hardDeadlineMs !== 960000 || task.assessmentDeadlineMs !== 180000) {
    throw new Error("HD witness cannot change native deadlines")
  }
  const manifestPath = resolve(task.runtimeManifestPath)
  const root = dirname(manifestPath)
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
  const releasePath = join(import.meta.dir, "release.json")
  const release = JSON.parse(readFileSync(releasePath, "utf8"))
  if (release.mainVersion !== "0.0.3207" || manifest.mainVersion !== release.mainVersion || manifest.experiment !== "published" || manifest.dependencyOverrides.length || manifest.sourceOverrides || task.dependencyOverrides.length) {
    throw new Error("HD witness requires the unchanged published 3207 package chain")
  }
  if (manifest.packages.length !== 4 || release.packages.length !== 4) throw new Error("HD witness requires exactly four published packages")
  const immutableFiles: FileIdentity[] = []
  const packages: PackageIdentity[] = manifest.packages
  for (const pkg of packages) {
    const expected = release.packages.find((item: PackageIdentity) => item.name === pkg.name)
    const folder = join(root, "npm", pkg.label)
    if (!expected || pkg.version !== expected.version || pkg.entrySha256 !== expected.entrySha256 || pkg.entry !== join(folder, pkg.entryRelative)) {
      throw new Error(`HD witness published package identity changed: ${pkg.name}`)
    }
    if (realpathSync(join(root, "runtime/node_modules", pkg.name)) !== folder) throw new Error(`HD witness original alias changed: ${pkg.name}`)
    for (const file of pkg.publishedFiles) {
      const path = join(folder, file.path)
      if (digest(readFileSync(path)) !== file.sha256) throw new Error(`Published package file changed: ${path}`)
      immutableFiles.push({ path, sha256: file.sha256 })
    }
  }
  const core = packages.find((pkg) => pkg.name === "@tscircuit/core")
  const autorouter = packages.find((pkg) => pkg.name === "@tscircuit/capacity-autorouter")
  if (!core || !autorouter || autorouter.entrySha256 !== originalAutorouterSha256) throw new Error("HD witness frozen Core/autorouter identity missing")
  const helperProofPath = join(root, "cases/assessment-helper-proof.json")
  const helperProof = JSON.parse(readFileSync(helperProofPath, "utf8"))
  if (helperProof.coreIdentity.entrySha256 !== core.entrySha256 || !helperProof.assessmentOnly || !helperProof.rendererNeverImportsThisAdapter) {
    throw new Error("Neutral assessment helper was not prepared from original Core")
  }
  for (const file of helperProof.files) {
    const original = readFileSync(join(dirname(core.entry), file.name))
    const helperPath = join(root, "cases/assessment-core", file.name)
    const expected = Buffer.concat([original, Buffer.from(file.appendedTail)])
    if (!file.prefixExact || digest(original) !== file.originalSha256 || !readFileSync(helperPath).equals(expected) || digest(expected) !== file.outputSha256) {
      throw new Error("Neutral assessment helper changed")
    }
    immutableFiles.push({ path: helperPath, sha256: file.outputSha256 })
  }
  const assessmentAutorouterAlias = {
    path: join(root, "cases/assessment-core/node_modules/@tscircuit/capacity-autorouter"),
    target: join(root, "npm/autorouter"),
  }
  if (existsSync(assessmentAutorouterAlias.path)) throw new Error("Refusing to reuse a neutral helper autorouter alias")
  mkdirSync(dirname(assessmentAutorouterAlias.path), { recursive: true })
  symlinkSync(assessmentAutorouterAlias.target, assessmentAutorouterAlias.path)
  for (const path of [manifestPath, resolve(casePath), releasePath, helperProofPath, task.sourcePath, ...task.implementationFiles.map((file: FileIdentity) => file.path), ...task.assessmentSourceFiles.map((file: FileIdentity) => file.path), ...["runtime/package.json", "runtime/bun.lock", "autorouter-dependencies/package.json", "autorouter-dependencies/bun.lock", "cases/assessment-core/package.json", "cases/find-floating-copper-assessment.mjs"].map((name) => join(root, name))]) {
    immutableFiles.push({ path, sha256: digest(readFileSync(path)) })
  }
  const patched = createHighDensityWitnessPatchedEntry(readFileSync(autorouter.entry, "utf8"))
  if (digest(patched.source) !== observedAutorouterSha256) throw new Error("Unexpected HD witness observer digest")
  const privateFolder = join(root, "npm/autorouter-hd-witness")
  if (existsSync(privateFolder)) throw new Error("Refusing to reuse an HD witness package copy")
  mkdirSync(privateFolder)
  const privateFiles: FileIdentity[] = []
  for (const file of autorouter.publishedFiles) {
    const target = join(privateFolder, file.path)
    mkdirSync(dirname(target), { recursive: true })
    if (file.path === autorouter.entryRelative) writeFileSync(target, patched.source)
    else copyFileSync(join(root, "npm/autorouter", file.path), target)
    privateFiles.push({ path: target, sha256: digest(readFileSync(target)) })
  }
  symlinkSync(realpathSync(join(root, "npm/autorouter/node_modules")), join(privateFolder, "node_modules"))
  const originalAlias = { path: join(root, "runtime/node_modules/@tscircuit/capacity-autorouter"), target: join(root, "npm/autorouter") }
  const proofPath = join(output, "hd-witness-runtime-proof.json")
  const proof: WitnessRuntimeProof = {
    mainVersion: "0.0.3207", casePath: resolve(casePath), caseSha256: digest(readFileSync(casePath)), manifestPath,
    originalEntry: autorouter.entry, originalEntrySha256: autorouter.entrySha256,
    observedEntry: join(privateFolder, autorouter.entryRelative), observedEntrySha256: digest(patched.source),
    originalAlias, assessmentAutorouterAlias, privateFolder, immutableFiles, privateFiles, originalPackages: packages, anchors: patched.anchors,
    observationalSourceOverride: true, routingPolicyOverride: false, neutralHelperPreparedBeforeOverride: true,
    originalAutorouterRestoredBeforeAssessment: false,
  }
  writeFileSync(proofPath, JSON.stringify(proof, null, 2))
  verifyHighDensityWitnessRuntime(proofPath, casePath, false)
  const selectionAlias = `${originalAlias.path}.hd-witness-selection`
  if (existsSync(selectionAlias)) throw new Error("Refusing to reuse an HD witness selection alias")
  symlinkSync(privateFolder, selectionAlias)
  renameSync(selectionAlias, originalAlias.path)
  return {
    proofPath,
    restore: (): void => {
      if (!lstatSync(originalAlias.path).isSymbolicLink() || realpathSync(originalAlias.path) !== privateFolder) throw new Error("Refusing to replace an unexpected witness alias")
      const restoreAlias = `${originalAlias.path}.hd-witness-restore`
      if (existsSync(restoreAlias)) throw new Error("Refusing to reuse an HD witness restore alias")
      symlinkSync(originalAlias.target, restoreAlias)
      renameSync(restoreAlias, originalAlias.path)
      verifyHighDensityWitnessRuntime(proofPath, casePath, false)
      proof.originalAutorouterRestoredBeforeAssessment = true
      writeFileSync(proofPath, JSON.stringify(proof, null, 2))
    },
  }
}
