import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { basename, join, resolve } from "node:path"

const [sourceArgument, proofArgument] = process.argv.slice(2)
assert(sourceArgument && proofArgument, "Expected Core source and proof directories")
const proof = resolve(proofArgument)
const require = createRequire(join(resolve(sourceArgument), "package.json"))
const ts = require("typescript")
const phaseName = "PcbCopperPourPreviewRender"
const previewMethod = `doInitial${phaseName}`
const helperModule = "lib/components/primitive-components/CopperPour/CopperPour_doInitialPcbCopperPourRender.ts"
const hash = text => createHash("sha256").update(text).digest("hex")
const reversals = []
const queueChecks = []

function parse(text, kind = ts.ScriptKind.JS) {
  const source = ts.createSourceFile("compiled-core", text, ts.ScriptTarget.Latest, true, kind)
  assert.equal(source.parseDiagnostics.length, 0, "Compiled output has parse diagnostics")
  return source
}

function tokens(text, roleByFile = new Map(), kind = ts.ScriptKind.JS) {
  const source = parse(text, kind)
  const result = []
  const visit = node => {
    const children = node.getChildren(source)
    if (children.length) {
      result.push(["start", node.kind])
      for (const child of children) visit(child)
      result.push(["end", node.kind])
      return
    }
    if (node.kind === ts.SyntaxKind.EndOfFileToken || node.kind === ts.SyntaxKind.SyntaxList) return
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

function catalog(folder) {
  const byRole = new Map()
  const roleByFile = new Map()
  for (const name of readdirSync(folder).filter(name => name.endsWith(".js")).sort()) {
    const text = readFileSync(join(folder, name), "utf8")
    const labels = [...text.matchAll(/^\/\/ ((?:lib\/|node_modules\/|package\.json|index\.ts)[^\n]*)$/gm)]
      .map(match => ({ name: match[1], start: match.index }))
    const role = name === "index.js" ? "index" : labels.length
      ? hash(JSON.stringify(labels.map(label => label.name)))
      : name.replace(/-[A-Z0-9]+\.js$/, ".js")
    assert(!byRole.has(role), `Ambiguous compiled chunk role: ${name}`)
    byRole.set(role, { name, text, labels, rawSha256: hash(text), source: parse(text) })
    roleByFile.set(name, role)
  }
  assert(byRole.size > 0, "Missing actual JavaScript build output")
  return { byRole, roleByFile }
}

function variable(file, name) {
  const declarations = file.source.statements.flatMap(statement => ts.isVariableStatement(statement)
    ? statement.declarationList.declarations.filter(declaration => ts.isIdentifier(declaration.name) && declaration.name.text === name)
    : [])
  assert(declarations.length <= 1, `Ambiguous top-level declaration: ${name}`)
  return declarations[0]
}

function classMember(file, className, memberName) {
  const declaration = variable(file, className)
  if (!declaration) return undefined
  assert(declaration.initializer && ts.isClassExpression(declaration.initializer), `Expected emitted ${className} class`)
  const members = declaration.initializer.members.filter(member => member.name?.getText(file.source) === memberName)
  assert(members.length <= 1, `Ambiguous class member: ${className}.${memberName}`)
  return members[0]
}

function declarationValue(node) {
  assert(node, "Missing initializer")
  if (ts.isStringLiteral(node)) return node.text
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(declarationValue)
  assert(ts.isObjectLiteralExpression(node), "Expected literal phase dependency object")
  return Object.fromEntries(node.properties.map(property => {
    assert(ts.isPropertyAssignment(property), "Unexpected dependency property")
    assert(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
    return [property.name.text, declarationValue(property.initializer)]
  }))
}

function helperStatements(file) {
  return file.source.statements.filter(statement => {
    if (ts.isImportDeclaration(statement)) return false
    const start = statement.getStart(file.source)
    const label = file.labels.findLast(label => label.start < start)
    return label?.name === helperModule
  })
}

function helperNames(statements) {
  return statements.flatMap(statement => {
    if (ts.isVariableStatement(statement)) {
      return statement.declarationList.declarations.map(declaration => {
        assert(ts.isIdentifier(declaration.name), "Unexpected helper destructuring declaration")
        return declaration.name.text
      })
    }
    assert(ts.isFunctionDeclaration(statement) && statement.name, "Unexpected helper runtime statement")
    return [statement.name.text]
  })
}

function reverseRuntimeChanges(base, candidate, role) {
  const edits = []
  const replace = (name, before, after) => {
    assert(before && after, `Missing ${name} in one build`)
    const beforeText = before.getText(base.source)
    const afterText = after.getText(candidate.source)
    const beforeWrapped = ts.isMethodDeclaration(before) ? `class Scope { ${beforeText} }` : `const scope = ${beforeText};`
    const afterWrapped = ts.isMethodDeclaration(after) ? `class Scope { ${afterText} }` : `const scope = ${afterText};`
    assert.notEqual(tokens(beforeWrapped), tokens(afterWrapped), `Expected ${name} to change`)
    edits.push({ start: after.getStart(candidate.source), end: after.end, text: beforeText })
    reversals.push({ name, role, beforeSha256: hash(beforeText), afterSha256: hash(afterText) })
  }
  const basePhases = variable(base, "orderedRenderPhases")
  const candidatePhases = variable(candidate, "orderedRenderPhases")
  if (basePhases || candidatePhases) {
    const before = declarationValue(basePhases?.initializer)
    const after = declarationValue(candidatePhases?.initializer)
    assert.equal(before.includes(phaseName), false)
    assert.equal(after.filter(name => name === phaseName).length, 1)
    assert.equal(after[after.indexOf(phaseName) + 1], "PcbCopperPourRender")
    assert.deepEqual(after.filter(name => name !== phaseName), before)
    replace("orderedRenderPhases.initializer", basePhases.initializer, candidatePhases.initializer)
  }
  const baseDependencies = variable(base, "asyncPhaseDependencies")
  const candidateDependencies = variable(candidate, "asyncPhaseDependencies")
  if (baseDependencies || candidateDependencies) {
    const before = declarationValue(baseDependencies?.initializer)
    const after = declarationValue(candidateDependencies?.initializer)
    assert.equal(phaseName in before, false)
    assert.deepEqual(after[phaseName], ["PcbFootprintStringRender", "FetchPartFootprint", "PcbPlacementDesignRuleChecks"])
    assert.deepEqual(Object.entries(after).filter(([, dependencies]) => dependencies.includes(phaseName))
      .map(([name, dependencies]) => {
        assert.equal(dependencies.filter(dependency => dependency === phaseName).length, 1)
        return name
      }).sort(), ["PcbCopperPourRender", "PcbViaStitchRender", "PcbCopperPourCleanup", "PcbDesignRuleChecks", "PcbSimulationRender"].sort())
    assert.deepEqual(Object.fromEntries(Object.entries(after)
      .filter(([name]) => name !== phaseName)
      .map(([name, dependencies]) => [name, dependencies.filter(dependency => dependency !== phaseName)])), before)
    replace("asyncPhaseDependencies.initializer", baseDependencies.initializer, candidateDependencies.initializer)
  }
  const baseRouting = classMember(base, "Group", "_startAsyncAutorouting")
  const candidateRouting = classMember(candidate, "Group", "_startAsyncAutorouting")
  if (baseRouting || candidateRouting) replace("Group._startAsyncAutorouting", baseRouting, candidateRouting)
  const basePreview = classMember(base, "CopperPour", previewMethod)
  const candidatePreview = classMember(candidate, "CopperPour", previewMethod)
  assert.equal(basePreview, undefined, "Baseline unexpectedly has a preview hook")
  if (candidatePreview) {
    const afterText = candidatePreview.getText(candidate.source)
    edits.push({ start: candidatePreview.getStart(candidate.source), end: candidatePreview.end, text: "" })
    reversals.push({ name: `CopperPour.${previewMethod}`, role, beforeSha256: hash(""), afterSha256: hash(afterText) })
  }
  const baseQueue = classMember(base, "Renderable", "_queueAsyncEffect")
  const candidateQueue = classMember(candidate, "Renderable", "_queueAsyncEffect")
  if (baseQueue || candidateQueue) {
    assert(baseQueue && candidateQueue)
    const beforeSha256 = hash(tokens(`class Scope { ${baseQueue.getText(base.source)} }`))
    const afterSha256 = hash(tokens(`class Scope { ${candidateQueue.getText(candidate.source)} }`))
    assert.equal(beforeSha256, afterSha256, "Generic effect scheduling changed")
    queueChecks.push({ role, beforeSha256, afterSha256 })
  }
  const beforeHelper = helperStatements(base)
  const afterHelper = helperStatements(candidate)
  if (beforeHelper.length || afterHelper.length) {
    assert.deepEqual(helperNames(beforeHelper), ["pendingCopperPourRenders", "DEFAULT_THERMAL_RELIEF_SPOKE_WIDTH_MM", "renderAllCopperPoursForSubcircuit", "CopperPour_doInitialPcbCopperPourRender"])
    assert.deepEqual(helperNames(afterHelper), ["pendingCopperPourRenders", "previewCopperPours", "DEFAULT_THERMAL_RELIEF_SPOKE_WIDTH_MM", "removePreviewPourReferences", "renderAllCopperPoursForSubcircuit", "CopperPour_doInitialPcbCopperPourRender"])
    for (const [file, statements] of [[base, beforeHelper], [candidate, afterHelper]]) {
      const first = file.source.statements.indexOf(statements[0])
      assert.deepEqual([...file.source.statements.slice(first, first + statements.length)], statements, "Helper runtime statements are not contiguous")
    }
    const beforeText = base.text.slice(beforeHelper[0].getStart(base.source), beforeHelper.at(-1).end)
    const afterText = candidate.text.slice(afterHelper[0].getStart(candidate.source), afterHelper.at(-1).end)
    assert.notEqual(tokens(beforeText), tokens(afterText))
    edits.push({ start: afterHelper[0].getStart(candidate.source), end: afterHelper.at(-1).end, text: beforeText })
    reversals.push({ name: "CopperPour render helper runtime declarations", role, beforeSha256: hash(beforeText), afterSha256: hash(afterText) })
  }
  edits.sort((left, right) => right.start - left.start)
  let normalized = candidate.text
  let nextStart = Infinity
  for (const edit of edits) {
    assert(edit.end <= nextStart, "Overlapping allowed runtime edits")
    normalized = normalized.slice(0, edit.start) + edit.text + normalized.slice(edit.end)
    nextStart = edit.start
  }
  return normalized
}

function auditDeclarations(baseFolder, candidateFolder) {
  const names = folder => readdirSync(folder).filter(name => /\.d\.(?:ts|mts)$/.test(name)).sort()
  const baseNames = names(baseFolder)
  assert(baseNames.length > 0, "Actual build did not emit TypeScript declarations")
  assert.deepEqual(names(candidateFolder), baseNames, "Declaration file set changed")
  const printer = ts.createPrinter({ removeComments: true })
  return baseNames.map(name => {
    const beforeText = readFileSync(join(baseFolder, name), "utf8")
    const afterText = readFileSync(join(candidateFolder, name), "utf8")
    const source = parse(afterText, ts.ScriptKind.TS)
    let removedPhases = 0
    let removedHooks = 0
    const isPreviewPhase = node => ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal) && node.literal.text === phaseName
    const transformed = ts.transform(source, [context => {
      const visit = node => {
        if (ts.isTupleTypeNode(node) || ts.isUnionTypeNode(node)) {
          const original = ts.isTupleTypeNode(node) ? node.elements : node.types
          const kept = original.filter(type => !isPreviewPhase(type))
          removedPhases += original.length - kept.length
          if (kept.length !== original.length) {
            node = ts.isTupleTypeNode(node) ? ts.factory.updateTupleTypeNode(node, kept) : ts.factory.updateUnionTypeNode(node, kept)
          }
        }
        if (ts.isClassDeclaration(node) && node.name?.text === "CopperPour") {
          const members = node.members.filter(member => {
            if (member.name?.getText(source) !== previewMethod) return true
            assert(ts.isMethodDeclaration(member) && member.parameters.length === 0 && member.type?.kind === ts.SyntaxKind.VoidKeyword && !member.body, "Unexpected preview hook declaration")
            removedHooks++
            return false
          })
          node = ts.factory.updateClassDeclaration(node, node.modifiers, node.name, node.typeParameters, node.heritageClauses, members)
        }
        return ts.visitEachChild(node, visit, context)
      }
      return root => ts.visitNode(root, visit)
    }])
    const normalized = printer.printFile(transformed.transformed[0])
    transformed.dispose()
    const beforeTokens = tokens(printer.printFile(parse(beforeText, ts.ScriptKind.TS)), undefined, ts.ScriptKind.TS)
    const afterTokens = tokens(normalized, undefined, ts.ScriptKind.TS)
    assert.equal(normalized.includes(`"${phaseName}"`), false, "Unexpected preview phase declaration outside an approved tuple or union")
    return { name, beforeSha256: hash(beforeText), afterSha256: hash(afterText), beforeTokenSha256: hash(beforeTokens), reversedTokenSha256: hash(afterTokens), removedPhases, removedHooks, equivalent: beforeTokens === afterTokens }
  })
}

const report = {
  passed: false,
  scope: "Actual Core build output differs only in the declared pour preview phase, routing registration method, preview hook, and existing pour render helper.",
  normalization: "Parser structure and tokens retain all other behavior. Only comments, token-external whitespace, and compiled chunk filenames identified by identical ordered module labels are normalized. No identifier renaming is ignored.",
  reversals,
  queueChecks,
}
try {
  const base = catalog(join(proof, "base/dist"))
  const candidate = catalog(join(proof, "candidate/dist"))
  assert.deepEqual([...candidate.byRole.keys()].sort(), [...base.byRole.keys()].sort(), "Compiled module roles changed")
  report.files = []
  for (const [role, before] of base.byRole) {
    const after = candidate.byRole.get(role)
    const reversedText = reverseRuntimeChanges(before, after, role)
    const beforeTokens = tokens(before.text, base.roleByFile)
    const afterTokens = tokens(reversedText, candidate.roleByFile)
    report.files.push({ role, base: { file: before.name, rawSha256: before.rawSha256, tokenSha256: hash(beforeTokens) }, candidate: { file: after.name, rawSha256: after.rawSha256, reversedTokenSha256: hash(afterTokens) }, equivalent: beforeTokens === afterTokens })
  }
  assert.deepEqual(reversals.map(row => row.name).sort(), ["orderedRenderPhases.initializer", "asyncPhaseDependencies.initializer", "Group._startAsyncAutorouting", `CopperPour.${previewMethod}`, "CopperPour render helper runtime declarations"].sort(), "Missing or repeated permitted runtime change")
  assert.equal(queueChecks.length, 1, "Missing or repeated generic effect queue implementation")
  report.declarations = auditDeclarations(join(proof, "base/dist"), join(proof, "candidate/dist"))
  assert(report.declarations.some(row => row.removedPhases > 0 && row.removedHooks === 1), "Missing expected public phase and preview hook declarations")
  report.differences = [...report.files.filter(row => !row.equivalent), ...report.declarations.filter(row => !row.equivalent)]
  assert.equal(report.differences.length, 0, "Production output changed outside the approved source scope")
  report.genericEffectSchedulingUnchanged = true
  report.passed = true
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error)
} finally {
  writeFileSync(join(proof, "production-build-equivalence.json"), JSON.stringify(report, null, 2) + "\n")
}
assert(report.passed, report.error)
