import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { basename, join, resolve } from "node:path"

const [sourceArgument, proofArgument] = process.argv.slice(2)
assert(sourceArgument && proofArgument)
const proof = resolve(proofArgument)
const require = createRequire(join(resolve(sourceArgument), "package.json"))
const ts = require("typescript")
let reversedBehaviorLines = 0
const hash = text => createHash("sha256").update(text).digest("hex")
const tokens = (text, roleByFile) => {
  const source = ts.createSourceFile("compiled-core.js", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  assert.equal(source.parseDiagnostics.length, 0, "Compiled Core JavaScript has parse diagnostics")
  const result = []
  const visit = node => {
    const children = node.getChildren(source)
    if (children.length) {
      // Keep parse structure as well: a newline can change automatic semicolon
      // insertion without changing the sequence of visible leaf tokens.
      result.push(["start", node.kind])
      for (const child of children) visit(child)
      result.push(["end", node.kind])
      return
    }
    if (node.kind === ts.SyntaxKind.EndOfFileToken || node.kind === ts.SyntaxKind.SyntaxList) return
    // Parser leaves retain entire regex and template tokens, including text
    // that a context-free scanner could mistake for comments or punctuation.
    let value = node.getText(source)
    if (ts.isStringLiteral(node)) {
      value = node.text
      if (value === `./${basename(value)}` && value.endsWith(".js")) {
        const role = roleByFile.get(basename(value))
        if (role) value = `compiled-chunk:${role}`
      }
    }
    result.push([node.kind, value])
  }
  visit(source)
  return JSON.stringify(result)
}
const catalog = folder => {
  const files = readdirSync(folder).filter(name => name.endsWith(".js")).sort()
  const byRole = new Map()
  const roleByFile = new Map()
  for (const name of files) {
    let text = readFileSync(join(folder, name), "utf8")
    if (folder.endsWith("/candidate/dist")) {
      const changed = "promise: Promise.resolve().then(effect),"
      reversedBehaviorLines += text.split(changed).length - 1
      text = text.replaceAll(changed, "promise: effect(),")
    }
    const labels = [...text.matchAll(/^\/\/ ((?:lib\/|node_modules\/|package\.json|index\.ts)[^\n]*)$/gm)].map(match => match[1])
    const role = name === "index.js" ? "index" : labels.length ? hash(JSON.stringify(labels)) : name.replace(/-[A-Z0-9]+\.js$/, ".js")
    assert(!byRole.has(role), `Ambiguous compiled chunk role: ${name}`)
    byRole.set(role, { name, text, labels })
    roleByFile.set(name, role)
  }
  return new Map([...byRole].map(([role, file]) => [role, {
    file: file.name, labels: file.labels, rawSha256: hash(file.text), tokenSha256: hash(tokens(file.text, roleByFile)),
  }]))
}
const base = catalog(join(proof, "base/dist"))
const candidate = catalog(join(proof, "candidate/dist"))
const differences = [...new Set([...base.keys(), ...candidate.keys()])]
  .filter(role => base.get(role)?.tokenSha256 !== candidate.get(role)?.tokenSha256)
  .map(role => ({ role, base: base.get(role), candidate: candidate.get(role) }))
const declarationNames = folder => readdirSync(folder)
  .filter(name => name.endsWith(".d.ts") || name.endsWith(".d.mts")).sort()
const baseDeclarations = declarationNames(join(proof, "base/dist"))
const candidateDeclarations = declarationNames(join(proof, "candidate/dist"))
assert(baseDeclarations.length > 0, "Real production build must emit declarations")
assert.deepEqual(baseDeclarations, candidateDeclarations)
for (const name of baseDeclarations) {
  assert.equal(readFileSync(join(proof, "base/dist", name), "utf8"),
    readFileSync(join(proof, "candidate/dist", name), "utf8"), `Declaration changed: ${name}`)
}
const report = {
  passed: reversedBehaviorLines === 1 && differences.length === 0,
  reversedBehaviorLines, declarationsIdentical: true, declarationFiles: baseDeclarations,
  scope: "All JavaScript emitted by unmodified bun run build, comparing parser-derived tokens and parse structure after reversing precisely the one approved effect deferral expression in candidate output.",
  normalization: "Comments and token-external whitespace ignored; parsed string values retained; relative compiled filenames normalized by exact ordered module-label list. No other source or runtime differences permitted.",
  base: Object.fromEntries(base), candidate: Object.fromEntries(candidate), differences,
}
writeFileSync(join(proof, "production-build-equivalence.json"), JSON.stringify(report, null, 2) + "\n")
assert(report.passed, "Actual production builds differ beyond the reviewed callback deferral")
