import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { basename, join, resolve } from "node:path"

const [sourceArgument, publishedArgument, baseArgument, reportArgument] = process.argv.slice(2)
assert(sourceArgument && publishedArgument && baseArgument && reportArgument)
const require = createRequire(join(resolve(sourceArgument), "package.json"))
const ts = require("typescript")
const hash = text => createHash("sha256").update(text).digest("hex")
const catalog = folder => {
  const files = readdirSync(folder).filter(name => name.endsWith(".js")).sort()
  const byRole = new Map()
  const roleByFile = new Map()
  for (const name of files) {
    const text = readFileSync(join(folder, name), "utf8")
    const labels = [...text.matchAll(/^\/\/ ((?:lib\/|node_modules\/|package\.json|index\.ts)[^\n]*)$/gm)].map(match => match[1])
    const role = name === "index.js" ? "index" : labels.length ? hash(JSON.stringify(labels)) : name.replace(/-[A-Z0-9]+\.js$/, ".js")
    assert(!byRole.has(role), `Ambiguous compiled chunk role: ${name}`)
    byRole.set(role, { name, text, labels })
    roleByFile.set(name, role)
  }
  const tokens = text => {
    const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, text)
    const result = []
    for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
      let value = scanner.getTokenText()
      if (token === ts.SyntaxKind.StringLiteral) {
        value = scanner.getTokenValue()
        if (value === `./${basename(value)}` && value.endsWith(".js")) {
          const role = roleByFile.get(basename(value))
          if (role) value = `compiled-chunk:${role}`
        }
      }
      result.push([token, value])
    }
    return JSON.stringify(result)
  }
  return new Map([...byRole].map(([role, file]) => [role, {
    file: file.name, labels: file.labels, rawSha256: hash(file.text), tokenSha256: hash(tokens(file.text)),
  }]))
}
const published = catalog(resolve(publishedArgument))
const base = catalog(resolve(baseArgument))
const differences = [...new Set([...published.keys(), ...base.keys()])].filter(role => published.get(role)?.tokenSha256 !== base.get(role)?.tokenSha256).map(role => ({ role, published: published.get(role), base: base.get(role) }))
const report = {
  passed: differences.length === 0,
  entirePublishedSourceClosureKnown: false,
  scope: "All published Core JavaScript chunks compared as compiled tokens, retaining identifiers, constants and statement order. Original source bodies cannot be recovered from an unpublished source map.",
  normalization: "Ignore comments and whitespace; compare string literal values; replace only relative compiled JS filenames with a unique role defined by that chunk's exact ordered module-label list. Every chunk is independently compared.",
  published: Object.fromEntries(published), base: Object.fromEntries(base), differences,
}
writeFileSync(resolve(reportArgument), JSON.stringify(report, null, 2) + "\n")
assert(report.passed, "Compiled Core control differs from published2402; inspect differences before any routing")
