import { readFileSync, writeFileSync, readdirSync } from "node:fs"
import { resolve } from "node:path"
import { createHash } from "node:crypto"

const runtime = resolve(process.argv[2])
const target = resolve(process.argv[3] ?? `${runtime}/node_modules/@tscircuit/capacity-autorouter`)
const ts = (await import(`${runtime}/node_modules/typescript/lib/typescript.js`)).default

function patchJavaScript({ source, label }) {
  const file = ts.createSourceFile(label, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  const nodes = [file]
  const all = []
  while (nodes.length) {
    const node = nodes.pop()
    all.push(node)
    ts.forEachChild(node, (child) => { nodes.push(child) })
  }
  const classes = new Map()
  for (const node of all) {
    if (!ts.isClassDeclaration(node) && !ts.isClassExpression(node)) continue
    const name = (ts.isVariableDeclaration(node.parent) ? node.parent.name.getText(file) : undefined) ?? node.name?.getText(file)
    if (name) classes.set(name, node)
  }
  const edits = []
  const roles = []
  const goalMethods = []
  for (const [name, node] of classes) {
    const methods = new Map(node.members.filter(ts.isMethodDeclaration).map((m) => [m.name.getText(file), m]))
    const compute = methods.get("computeG")
    const statement = compute?.body?.statements[0]
    if (compute && compute.body.statements.length === 1 && ts.isReturnStatement(statement) && ts.isPropertyAccessExpression(statement.expression) && statement.expression.name.text === "g") {
      const baseName = node.heritageClauses?.[0]?.types[0]?.expression.getText(file)
      const base = classes.get(baseName)
      const baseMethods = new Map((base?.members ?? []).filter(ts.isMethodDeclaration).map((m) => [m.name.getText(file), m]))
      if (!baseMethods.has("isKnownSingleLayerRegion")) continue
      const current = compute.parameters[0].name.getText(file)
      let neighbor = compute.parameters[1]?.name.getText(file)
      if (!neighbor) {
        neighbor = "neighborPortId"
        edits.push({ start: compute.parameters[0].end, end: compute.parameters[0].end, replacement: `,${neighbor}` })
      }
      const predicates = [...classes.values()].flatMap((candidate) => candidate.members.filter((m) => ts.isMethodDeclaration(m) && m.name.getText(file) === "segmentsCrossOnSameLayer"))
      if (predicates.length !== 1) throw new Error(`Expected one shared crossing predicate in ${label}`)
      const predicate = predicates[0]
      edits.push({ start: predicate.getStart(file), end: predicate.end, replacement: "" })
      edits.push({ start: base.members.end, end: base.members.end, replacement: predicate.getText(file) })
      roles.push("shared-crossing-predicate")
      const replacement = `{const regionId=${current}.nextRegionId;if(!this.isKnownSingleLayerRegion(regionId))return ${current}.g;const crossesFixedCopper=this.state.regionSegments[regionId].some(([routeId,fromPortId,toPortId])=>this.problem.routeIsFixed?.[routeId]===1&&this.problem.routeNet[routeId]!==this.state.currentRouteNetId&&this.segmentsCrossOnSameLayer(regionId,${current}.portId,${neighbor},fromPortId,toPortId));return crossesFixedCopper?Infinity:${current}.g}`
      edits.push({ start: compute.body.getStart(file), end: compute.body.end, replacement })
      roles.push(`greedy:${name}`)
      goalMethods.push({ method: baseMethods.get("_step"), receiver: "this", reserved: true }, { method: baseMethods.get("expandRegionalHopFrontier"), receiver: "this", reserved: true })
    }
    if (methods.has("expand") && methods.has("step") && node.getText(file).includes(".frontiers") && node.getText(file).includes(".rows")) {
      goalMethods.push({ method: methods.get("expand"), reserved: false })
    }
  }
  for (const { method, receiver, reserved } of goalMethods) {
    if (!method) throw new Error(`Missing goal method in ${label}`)
    const branches = all.filter((n) => ts.isIfStatement(n) && n.getStart(file) >= method.getStart(file) && n.end <= method.end && /goalPortId/.test(n.expression.getText(file)))
    let count = 0
    for (const branch of branches) {
      const condition = branch.expression
      if (!ts.isBinaryExpression(condition) || !ts.isIdentifier(condition.left) || !ts.isPropertyAccessExpression(condition.right) || condition.right.name.text !== "goalPortId") continue
      const block = branch.thenStatement
      if (reserved && !block.getText(file).includes(".isPortReservedForDifferentNet")) continue
      const calls = all.filter((n) => ts.isCallExpression(n) && n.getStart(file) >= block.getStart(file) && n.end <= block.end && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "onPathFound")
      if (calls.length !== 1) continue
      const call = calls[0]
      const owner = call.expression.expression.getText(file)
      if (receiver && owner !== receiver) continue
      const current = call.arguments[0].getText(file)
      const neighbor = condition.left.getText(file)
      const guard = `if(!Number.isFinite(${owner}.computeG(${current},${neighbor})))continue;`
      if (!ts.isBlock(block)) {
        edits.push({ start: block.getStart(file), end: block.end, replacement: `{${guard}${block.getText(file)}}` })
      } else {
        let statement = call
        while (!ts.isStatement(statement) && statement !== block) statement = statement.parent
        if (statement === block) throw new Error(`Goal call is not a statement in ${label}`)
        edits.push({ start: statement.getStart(file), end: statement.getStart(file), replacement: guard })
      }
      count++
    }
    if (count !== 1) throw new Error(`Expected one goal branch in ${label}/${method.name.getText(file)}, got ${count}`)
    roles.push(`goal:${method.name.getText(file)}`)
  }
  for (const node of all) {
    if ((!ts.isStringLiteral(node) && !ts.isNoSubstitutionTemplateLiteral(node)) || !node.text.includes("createGreedyFinalRouteSolver")) continue
    const nested = patchJavaScript({ source: node.text, label: `${label}:worker` })
    edits.push({ start: node.getStart(file), end: node.end, replacement: JSON.stringify(nested.source) })
    roles.push(...nested.roles)
  }
  for (const edit of edits.sort((a, b) => b.start - a.start)) source = source.slice(0, edit.start) + edit.replacement + source.slice(edit.end)
  return { source, roles }
}

const records = []
const modified = []
const entry = readFileSync(`${target}/dist/index.js`, "utf8")
if (createHash("sha256").update(entry).digest("hex") !== "dafd4c2ce84f458b915b6884cae1fbacf0408c1401d3e4fadf25454658b685eb") throw new Error("Autorouter release does not match the measured baseline")
for (const relative of readdirSync(`${target}/dist`, { recursive: true }).filter((p) => p.endsWith(".js"))) {
  const path = `${target}/dist/${relative}`
  const source = readFileSync(path, "utf8")
  const result = patchJavaScript({ source, label: path })
  if (result.roles.length === 0) continue
  if (result.roles.length % 5 !== 0) throw new Error(`Expected five changes per solver bundle in ${path}, got ${JSON.stringify(result.roles)}`)
  const parsed = ts.createSourceFile(path, result.source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  if (parsed.parseDiagnostics.length) throw new Error(`Patched JavaScript did not parse: ${path}`)
  modified.push({ path, source: result.source })
  records.push({ path, roles: result.roles, before: createHash("sha256").update(source).digest("hex"), after: createHash("sha256").update(result.source).digest("hex") })
}
if (records.reduce((sum, r) => sum + r.roles.length, 0) !== 5) throw new Error(`Expected one graph solver bundle: ${JSON.stringify(records.map((r) => ({path:r.path,roles:r.roles})))}`)
for (const platform of ["bun", "node"]) {
  const path = `${target}/dist/runtime/${platform}.js`
  const source = readFileSync(path, "utf8")
  if (source.includes("goalPortId") || source.includes("createGreedyFinalRouteSolver")) throw new Error(`Unexpected graph routing code in ${platform} worker`)
  const hash = createHash("sha256").update(source).digest("hex")
  records.push({path, roles: [], before: hash, after: hash})
}
for (const file of modified) writeFileSync(file.path, file.source)
const out = process.argv[4]
if (out) writeFileSync(out, JSON.stringify(records, null, 2) + "\n")
console.log(JSON.stringify(records, null, 2))
