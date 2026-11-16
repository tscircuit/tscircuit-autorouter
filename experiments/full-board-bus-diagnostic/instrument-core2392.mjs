import { createHash } from "node:crypto"
export const ORIGINAL_CORE_SHA256 = "cdd8fd63614327e7037617f62c0cc732861be5e969e53bdb99c0b0831e493fd1"
export const OBSERVER_SYMBOL = "tscircuit.bus58.negotiation-observer"

/** Produces a private observation-only copy; never writes original Core bytes. */
export function instrumentCore2392(source) {
  const originalBytes = Buffer.byteLength(source)
  if (createHash("sha256").update(source).digest("hex") !== ORIGINAL_CORE_SHA256) throw Error("Unexpected published Core2392 bytes")
  const anchors = []
  const once = (text, from, to, name) => {
    if (text.split(from).length !== 2) throw Error(`Nonunique diagnostic anchor: ${name}`)
    anchors.push(name)
    return text.replace(from, to)
  }
  const edit = (start, end, transform) => {
    const a = source.indexOf(start), b = source.indexOf(end, a + start.length)
    if (a < 0 || b < 0) throw Error(`Missing diagnostic region: ${start}`)
    source = source.slice(0,a) + transform(source.slice(a,b)) + source.slice(b)
  }
  source = once(source, "function fixedCopper(input) {", `var __bus58Observer = globalThis[Symbol.for("${OBSERVER_SYMBOL}")];
var __bus58ProbeContext;
var __bus58TaggedChildren = new WeakSet();
function __bus58Observe(event, details) {
  if (typeof __bus58Observer !== "function") return;
  try { __bus58Observer(event, details); } catch {}
}
function __bus58Probe(context, test) {
  const previous = __bus58ProbeContext;
  __bus58ProbeContext = context;
  try { return test(); } finally { __bus58ProbeContext = previous; }
}
function __bus58Block(scene, a, b, copper, margin, reason) {
  if (__bus58ProbeContext) __bus58Observe("probe_blocked", { context: __bus58ProbeContext, scene, a, b, copper, margin, reason });
}
function __bus58Component(search, attachment, side, value) {
  __bus58Observe("component_value", { search, attachment, side, value });
  return value;
}
function __bus58Return(event, result, details) {
  __bus58Observe(event, { ...details, result });
  return result;
}
function __bus58Collision(result, details) {
  if (result) __bus58Observe("site_copper_conflict", { ...details, conflict: result });
  return result;
}
function __bus58Child(pipeline, child) {
  if (!__bus58TaggedChildren.has(child)) {
    __bus58TaggedChildren.add(child);
    __bus58Observe("lane_child_tag", { pipeline, child });
  }
  return child;
}
function fixedCopper(input) {`, "observer declaration")

  edit("var VectorScene = class", "function routeAnglesAreConventional", block => {
    block = once(block,
      `    ))
      return false;
    if (this.input.outline?.length && !this.boardEdgeIsClear(a2, b2)) return false;`,
      `    )) {
      __bus58Block(this, a2, b2, void 0, void 0, "board_bounds");
      return false;
    }
    if (this.input.outline?.length && !this.boardEdgeIsClear(a2, b2)) {
      __bus58Block(this, a2, b2, void 0, void 0, "board_outline");
      return false;
    }`, "visibility early boundaries")
    block = once(block, "(c2) => copperTooClose(a2, b2, c2, this.margin - 1e-8)", `(c2) => {
          const diagnosticMargin = this.margin - 1e-8;
          const blocked = copperTooClose(a2, b2, c2, diagnosticMargin);
          if (blocked) __bus58Block(this, a2, b2, c2, diagnosticMargin, "copper");
          return blocked;
        }`, "indexed existing copper rejection")
    return once(block, "if (copperTooClose(a2, b2, c2, this.margin - 1e-8)) return false;", `const diagnosticMargin = this.margin - 1e-8;
      if (copperTooClose(a2, b2, c2, diagnosticMargin)) {
        __bus58Block(this, a2, b2, c2, diagnosticMargin, "copper");
        return false;
      }`, "linear existing copper rejection")
  })

  edit("var GridVisibilitySearch = class", "function remapCurvedSegments", block => {
    block = once(block,
      `          for (const path of connectors(p2, this.point(id)))
            if (scene.pathVisible(path)) {`,
      `          for (const path of connectors(p2, this.point(id)))
            if (__bus58Probe({ kind: "terminal_attachment", search: this, terminal: p2, gridId: id, path }, () => scene.pathVisible(path))) {`, "native attachment predicate")
    block = once(block, "    if (!a2 || !z23) {\n      this.failed = true;", `    if (!a2 || !z23) {
      __bus58Observe("search_failed", { search: this, reason: "no_terminal_attachment" });
      this.failed = true;`, "missing discrete attachment")
    block = once(block,
      "components.at(start2.id) !== 0 && components.at(start2.id) === components.at(end2.id)",
      '__bus58Component(this, start2, "start_nonzero", components.at(start2.id)) !== 0 && __bus58Component(this, start2, "start_compare", components.at(start2.id)) === __bus58Component(this, end2, "end_compare", components.at(end2.id))', "tap existing component lookups")
    block = once(block, "      if (!sameComponent(this.startAttachments, this.endAttachments)) {\n        this.failed = true;", `      if (!sameComponent(this.startAttachments, this.endAttachments)) {
        __bus58Observe("search_failed", { search: this, reason: "disconnected_discrete_components" });
        this.failed = true;`, "discrete component failure")
    block = once(block, "    this.result = path;\n    this.solved = true;", `    this.result = path;
    this.solved = true;
    __bus58Observe("search_solved", { search: this });`, "actual search success")
    block = once(block,
      '        if (this.retryAttachments()) continue;\n        this.failed = true;',
      `        if (this.retryAttachments()) continue;
        __bus58Observe("search_failed", { search: this, reason: "frontier_exhausted_after_attachment_retries" });
        this.failed = true;`, "frontier exhaustion")
    return once(block,
      '            if (this.retryAttachments()) continue;\n            this.failed = true;',
      `            if (this.retryAttachments()) continue;
            __bus58Observe("search_failed", { search: this, reason: "returned_path_invalid_after_attachment_retries", path: result });
            this.failed = true;`, "returned path rejection")
  })

  edit("function* runBoundedRouting(generator, limit) {", "function shortenPairApproaches", block => once(block,
    "    return state.done ? state.value : null;",
    '    return __bus58Return("bounded_result", state.done ? state.value : null, { generator, limit, steps, state });', "bounded result without extra next"))

  edit("function* negotiateLanes(input,", "function independentBusGroups", block => {
    block = once(block, "  const flexibleTerminals =", `  const diagnosticInvocation = { input, connections };
  __bus58Observe("lane_negotiation_start", { invocation: diagnosticInvocation });
  const flexibleTerminals =`, "initial lane invocation")
    block = once(block,
      "        if (!histories.has(candidateLayer))\n          histories.set(",
      `        __bus58Observe("search_tag", { search: candidateSearch, stage: "lane_candidate", invocation: diagnosticInvocation, connection, layer: candidateLayer });
        if (!histories.has(candidateLayer))
          histories.set(`, "lane candidate search identity")
    block = once(block,
      `          try {
            while (!candidateSearch.solved && !candidateSearch.failed) {`,
      `          __bus58Observe("search_tag", { search: candidateSearch, stage: "lane_unpenalized_retry", invocation: diagnosticInvocation, connection, layer: candidateLayer });
          try {
            while (!candidateSearch.solved && !candidateSearch.failed) {`, "unpenalized original retry identity")
    block = once(block, "        if (!certificatePaths.length) return null;", `        if (!certificatePaths.length) {
          __bus58Observe("lane_null", { reason: "no_best_choice_no_certificate", invocation: diagnosticInvocation, connection, available, iteration, routed, queue });
          return null;
        }`, "initial fatal no choice")
    block = once(block, "        if (previous.length !== unit.connections.length) return null;", `        if (previous.length !== unit.connections.length) {
          __bus58Observe("lane_null", { reason: "coupled_pair_without_previous_certificate", invocation: diagnosticInvocation, connection, iteration, previous });
          return null;
        }`, "initial fatal coupled pair")
    return once(block, "  return null;\n}\n", `  __bus58Observe("lane_null", { reason: "negotiation_rounds_exhausted", invocation: diagnosticInvocation, routed, queue, visits });
  return null;
}
`, "initial lane final exhaustion")
  })

  edit("function* expandedSignalSiteChoices({", "function* expandedSignalSites", block => {
    block = once(block, "  if (ends.some((sites) => !sites.length)) return [];", `  if (ends.some((sites) => !sites.length)) {
    __bus58Observe("expanded_sites_empty", { input, connection, targetLayer: targetLayer2, allowPadEdgeSites, ends });
    return [];
  }`, "expanded endpoint domain empty")
    block = once(block, "      if (!search.solved) break;", `      __bus58Observe("search_probe_end", { search, steps, limit: 1e4, attempts });
      if (!search.solved) break;`, "expanded pair bounded work")
    return once(block, "    try {\n      let steps = 0;", `    __bus58Observe("search_tag", { search, stage: "expanded_site_pair", input, connection, layer: targetLayer2, starts, goals, allowPadEdgeSites });
    try {
      let steps = 0;`, "expanded pair search identity")
  })

  edit("function generatedEscapeHolesConflict(input, first, second) {", "function* expandedSignalSiteChoices", block => once(block,
    "        return true;\n  return false;",
    `        {
          __bus58Observe("escape_hole_conflict", { input, first, second, a: a2, b: b2 });
          return true;
        }
  return false;`, "actual escape hole conflict pair"))

  edit("function* expandedSignalSites({", "function ", block => {
    block = once(block,
      "        if (viaScenes.some((scene2) => !scene2.visible(point52, point52))) continue;",
      `        if (viaScenes.some((scene2) => !__bus58Probe({ kind: "via_site", input, connection, owner, pad, end, point: point52, targetLayer: targetLayer2, alignSurfaceGrid, allowPadEdgeSites }, () => scene2.visible(point52, point52)))) continue;`, "actual full-span via site rejection")
    block = once(block,
      `          (via) => distance15(via, point52) < hole / 2 + (via.via_hole_diameter ?? input.minViaHoleDiameter ?? 0.15) / 2 + holeClearance - 1e-8`,
      `          (via) => {
            const diagnosticDistance = distance15(via, point52);
            const diagnosticRequired = hole / 2 + (via.via_hole_diameter ?? input.minViaHoleDiameter ?? 0.15) / 2 + holeClearance - 1e-8;
            const blocked = diagnosticDistance < diagnosticRequired;
            if (blocked) __bus58Observe("via_hole_rejected", { input, connection, owner, pad, point: point52, via, end, targetLayer: targetLayer2, alignSurfaceGrid, allowPadEdgeSites, distance: diagnosticDistance, required: diagnosticRequired });
            return blocked;
          }`, "existing via hole rejection")
    block = once(block, "          if (!search.solved) continue;", `          __bus58Observe("search_probe_end", { search, steps, limit: 4e3 });
          if (!search.solved) continue;`, "expanded surface bounded work")
    block = once(block, "        try {\n          let steps = 0;", `        __bus58Observe("search_tag", { search, stage: "expanded_surface_escape", input, connection, layer: pad.layer, pad, point: point52, end, alignSurfaceGrid, allowPadEdgeSites });
        try {
          let steps = 0;`, "expanded surface search identity")
    return block
  })

  edit("function* negotiateSignalSites(state,", "function* routeGeneratedSignalSites", block => {
    block = once(block, "  if (!remove.size) return null;", `  const diagnosticInvocation = { state, options };
  __bus58Observe("site_pass_start", { invocation: diagnosticInvocation });
  if (!remove.size) return null;`, "site pass identity")
    block = once(block, "      } catch {\n      }\n      yield;", `      } catch (diagnosticError) {
        __bus58Observe("site_variant_exception", { invocation: diagnosticInvocation, connection, variant, error: diagnosticError });
      }
      yield;`, "dogbone variant exception")
    block = once(block, "    const choices = previous ? [previous.option] : [];", `    __bus58Observe("site_endpoint_options", { invocation: diagnosticInvocation, connection, ends, carrierLayers, single });
    const choices = previous ? [previous.option] : [];`, "actual endpoint site arrays")
    block = once(block, "          try {\n            let steps = 0;", `          __bus58Observe("search_tag", { search, stage: "site_pair_viability", invocation: diagnosticInvocation, connection, layer, escapes, local });
          try {
            let steps = 0;`, "site viability search identity")
    block = once(block,
      "            if (search.solved)\n              choices.push({",
      `            __bus58Observe("search_probe_end", { search, steps, limit: 3e3 });
            if (search.solved)
              choices.push({`, "site viability bounded work")
    block = once(block, "      options.onBlockedConnection?.(connection.name);\n      return null;", `      options.onBlockedConnection?.(connection.name);
      __bus58Observe("site_null", { reason: "zero_route_choices", invocation: diagnosticInvocation, connection, ends, carrierLayers, variants });
      return null;`, "fatal empty native-net domain")
    block = once(block,
      "  const overlap = (a2, b2) => copperConflicts.firstConflict(a2, b2, clearance - 1e-8);",
      '  const overlap = (a2, b2) => __bus58Collision(copperConflicts.firstConflict(a2, b2, clearance - 1e-8), { invocation: diagnosticInvocation, first: a2, second: b2 });', "actual escape compatibility copper pair")
    block = once(block,
      "      (index2) => options.onBlockedConnection?.(entries[index2][0])",
      `(index2) => {
        __bus58Observe("site_pruned_empty", { invocation: diagnosticInvocation, index: index2, entries });
        return options.onBlockedConnection?.(entries[index2][0]);
      }`, "compatibility-pruned native-net domain")
    block = once(block, "    if (!domains) return null;", `    if (!domains) {
      __bus58Observe("site_null", { reason: "escape_compatibility_domains_empty", invocation: diagnosticInvocation, entries });
      return null;
    }`, "fatal pruned domains")
    block = once(block, "      try {\n        let steps = 0;", `      __bus58Observe("search_tag", { search, stage: "site_negotiated_route", invocation: diagnosticInvocation, connection, layer, option, iteration });
      try {
        let steps = 0;`, "negotiated route search identity")
    block = once(block,
      "        if (search.solved) {\n          const trace = signalTrace(native, connection, search.result, layer),",
      `        __bus58Observe("search_probe_end", { search, steps, limit: 3e3 });
        if (search.solved) {
          const trace = signalTrace(native, connection, search.result, layer),`, "negotiated route bounded work")
    return once(block, "  return routed.size === base.connections.length ? finish() : null;", `  return __bus58Return("site_result", routed.size === base.connections.length ? finish() : null, { invocation: diagnosticInvocation, routed, queue, variants, pools: pools2, visits });`, "actual site pool final result")
  })

  edit("function* routeGeneratedSignalSites({", "function* negotiateGeneratedSignalSites", block => {
    block = once(block, "  const routed = yield* runBoundedRouting(\n    negotiateGeneratedSignalSites(input),", `  const diagnosticGenerator = negotiateGeneratedSignalSites(input);
  __bus58Observe("bounded_tag", { generator: diagnosticGenerator, stage: "generated_site_negotiation", input, maxSteps });
  const routed = yield* runBoundedRouting(
    diagnosticGenerator,`, "bounded generated-site identity")
    return block
  })

  edit("var BusLanesPipelineSolver = class", "// lib/utils/autorouting/BusLanesAutorouter.ts", block => {
    block = once(block, "  prepare() {", `  prepare() {
    __bus58Observe("pipeline_prepare", { pipeline: this });`, "pipeline attempt identity")
    block = once(block, "      this.child.step();", "      __bus58Child(this, this.child).step();", "actual lane child identity")
    return once(block, "        if (!state.done) return;\n        this.surfaceFinishing = void 0;", `        if (!state.done) return;
        __bus58Observe("surface_done", { pipeline: this, state });
        this.surfaceFinishing = void 0;`, "completed native surface result")
  })

  return { source, proof: { originalSha256: ORIGINAL_CORE_SHA256, instrumentedSha256: createHash("sha256").update(source).digest("hex"), originalByteLength: originalBytes, instrumentedByteLength: Buffer.byteLength(source), observerSymbol: OBSERVER_SYMBOL, anchors, algorithmOptionsChanged: false, extraOriginalPredicateEvaluations: 0, wallClockOutcomeParityGuaranteed: false } }
}
