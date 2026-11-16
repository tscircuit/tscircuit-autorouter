import { createHash } from "node:crypto"

export const ORIGINAL_CORE_SHA256 = "cdd8fd63614327e7037617f62c0cc732861be5e969e53bdb99c0b0831e493fd1"
export const OBSERVER_SYMBOL = "tscircuit.bus58.surface-observer"

/** Returns a private diagnostic copy. The original npm file is never written. */
export function instrumentCore2392(source) {
  const originalSha256 = createHash("sha256").update(source).digest("hex")
  if (originalSha256 !== ORIGINAL_CORE_SHA256) throw new Error("Unexpected published Core2392 bytes")
  const anchors = []
  const replaceOnce = (text, from, to, label) => {
    if (text.split(from).length !== 2) throw new Error(`Nonunique diagnostic anchor: ${label}`)
    anchors.push(label)
    return text.replace(from, to)
  }
  const editFunction = (start, end, edit) => {
    const first = source.indexOf(start)
    const last = source.indexOf(end, first + start.length)
    if (first < 0 || last < 0) throw new Error(`Missing diagnostic function: ${start}`)
    const original = source.slice(first, last)
    source = source.slice(0, first) + edit(original) + source.slice(last)
  }

  // The harness installs one callback before importing Core. No callback result
  // enters routing control flow. Callback failures cannot change solver results.
  source = replaceOnce(source, "function fixedCopper(input) {", `var __bus58Observer = globalThis[Symbol.for("${OBSERVER_SYMBOL}")];
var __bus58Normalization;
function __bus58Observe(event, details) {
  if (typeof __bus58Observer !== "function") return;
  try { __bus58Observer(event, details); } catch {}
}
function __bus58Blocked(scene, a, b, copper, margin) {
  if (__bus58Normalization?.candidate)
    __bus58Observe("visibility_blocked", { context: __bus58Normalization, scene, a, b, copper, margin });
}
function __bus58Copper(kind, copper, original, replacement) {
  if (__bus58Normalization)
    __bus58Observe("normalization_copper", { context: __bus58Normalization, kind, copper, original, replacement });
  return copper;
}
function fixedCopper(input) {`, "observer declaration")

  editFunction("var VectorScene = class", "function routeAnglesAreConventional", block => {
    block = replaceOnce(block,
      `    ))
      return false;
    if (this.input.outline?.length && !this.boardEdgeIsClear(a2, b2)) return false;`,
      `    )) {
      if (__bus58Normalization?.candidate) __bus58Observe("visibility_boundary", { reason: "board_bounds", context: __bus58Normalization, scene: this, a: a2, b: b2 });
      return false;
    }
    if (this.input.outline?.length && !this.boardEdgeIsClear(a2, b2)) {
      if (__bus58Normalization?.candidate) __bus58Observe("visibility_boundary", { reason: "board_outline", context: __bus58Normalization, scene: this, a: a2, b: b2 });
      return false;
    }`, "visibility bounds and outline rejection")
    block = replaceOnce(block,
      "(c2) => copperTooClose(a2, b2, c2, this.margin - 1e-8)",
      `(c2) => {
          const diagnosticMargin = this.margin - 1e-8;
          const blocked = copperTooClose(a2, b2, c2, diagnosticMargin);
          if (blocked) __bus58Blocked(this, a2, b2, c2, diagnosticMargin);
          return blocked;
        }`, "indexed first blocker")
    return replaceOnce(block,
      "if (copperTooClose(a2, b2, c2, this.margin - 1e-8)) return false;",
      `const diagnosticMargin = this.margin - 1e-8;
      if (copperTooClose(a2, b2, c2, diagnosticMargin)) {
        __bus58Blocked(this, a2, b2, c2, diagnosticMargin);
        return false;
      }`, "linear first blocker")
  })

  editFunction("function joinedSignalGeometryIsValid(params) {", "function* matchNativeCarrierSignals", block => {
    block = replaceOnce(block,
      "if (!traceStaysInsideOutline(input, trace)) return false;",
      `if (!traceStaysInsideOutline(input, trace)) {
    __bus58Observe("joined_rejected", { reason: "outline", input, trace });
    return false;
  }`, "joined outline rejection")
    block = replaceOnce(block,
      'if (params.smoothTuning !== false && !nativeSignalGeometryIsValid(trace))\n    return false;',
      `if (params.smoothTuning !== false && !nativeSignalGeometryIsValid(trace)) {
    __bus58Observe("joined_rejected", { reason: "native_angle_or_curve_metadata", input, trace });
    return false;
  }`, "joined native rejection")
    block = replaceOnce(block,
      '))\n        return false;\n      run = [];',
      `)) {
        __bus58Observe("joined_rejected", { reason: "self_clear_completed_run", input, trace, run, clearance });
        return false;
      }
      run = [];`, "joined completed run rejection")
    block = replaceOnce(block, "  return run.length < 2 || tuningPathIsSelfClear(", "  const diagnosticValid = run.length < 2 || tuningPathIsSelfClear(", "joined final result")
    return replaceOnce(block,
      '  );\n}\n',
      `  );
  if (!diagnosticValid) __bus58Observe("joined_rejected", { reason: "self_clear_final_run", input, trace, run, clearance });
  return diagnosticValid;
}
`, "joined final rejection")
  })

  editFunction("function carrierEndCandidates(trace, scene, atStart) {", "function normalizeCarrierEnds", block => replaceOnce(block,
    "      if (!monotone(replacement) || !scene.pathVisible(replacement)) continue;",
    `      if (__bus58Normalization) __bus58Normalization.candidate = { kind: "carrier_end_generation", original: trace, trace: candidate, visibilityRoute: replacement, atStart };
      let diagnosticVisible;
      const diagnosticMonotone = monotone(replacement);
      const diagnosticRejected = !diagnosticMonotone || !(diagnosticVisible = scene.pathVisible(replacement));
      if (__bus58Normalization) {
        __bus58Observe("normalization_candidate", { context: __bus58Normalization, scene, monotone: diagnosticMonotone, visible: diagnosticVisible, accepted: !diagnosticRejected });
        __bus58Normalization.candidate = void 0;
      }
      if (diagnosticRejected) continue;`, "carrier candidate generation short circuit"))

  editFunction("function normalizeCarrierEnds(trace, scene) {", "function octilinearSurfaceEscape", block => replaceOnce(block,
    `  for (const candidate of candidates)
    if (octilinear(candidate) && routeAnglesAreConventional([candidate]) && tuningPathIsSelfClear(candidate.route, scene.width / 2 + scene.margin) && scene.pathVisible(candidate.route))
      return candidate;`,
    `  for (const candidate of candidates) {
    if (__bus58Normalization) __bus58Normalization.candidate = { kind: "carrier_end", original: trace, trace: candidate };
    let diagnosticAngles, diagnosticSelfClear, diagnosticVisible;
    const diagnosticOctilinear = octilinear(candidate);
    const diagnosticAccepted = diagnosticOctilinear && (diagnosticAngles = routeAnglesAreConventional([candidate])) && (diagnosticSelfClear = tuningPathIsSelfClear(candidate.route, scene.width / 2 + scene.margin)) && (diagnosticVisible = scene.pathVisible(candidate.route));
    if (__bus58Normalization) {
      __bus58Observe("normalization_candidate", { context: __bus58Normalization, scene, octilinear: diagnosticOctilinear, angles: diagnosticAngles, selfClear: diagnosticSelfClear, visible: diagnosticVisible, accepted: diagnosticAccepted });
      __bus58Normalization.candidate = void 0;
    }
    if (diagnosticAccepted) return candidate;
  }`, "carrier candidate short circuit"))

  editFunction("function octilinearSurfaceEscape(escape, scene) {", "function normalizeSurfaceCarriers", block => replaceOnce(block,
    `      if (!scene.pathVisible(route) || !tuningPathIsSelfClear(route, scene.width / 2 + scene.margin) && tuningPathIsSelfClear(result.route, scene.width / 2 + scene.margin))
        continue;`,
    `      if (__bus58Normalization) __bus58Normalization.candidate = { kind: "surface_bend", original: result, candidateRoute: route };
      let diagnosticSelfClear, diagnosticOriginalSelfClear;
      const diagnosticVisible = scene.pathVisible(route);
      const diagnosticRejected = !diagnosticVisible || !(diagnosticSelfClear = tuningPathIsSelfClear(route, scene.width / 2 + scene.margin)) && (diagnosticOriginalSelfClear = tuningPathIsSelfClear(result.route, scene.width / 2 + scene.margin));
      if (__bus58Normalization) {
        __bus58Observe("normalization_candidate", { context: __bus58Normalization, scene, visible: diagnosticVisible, selfClear: diagnosticSelfClear, originalSelfClear: diagnosticOriginalSelfClear, accepted: !diagnosticRejected });
        __bus58Normalization.candidate = void 0;
      }
      if (diagnosticRejected) continue;`, "surface candidate short circuit"))

  editFunction("function normalizeSurfaceCarriers(input, traces, generatedEscapes) {", "var reverse3 =", block => {
    block = replaceOnce(block, "  const replacements =", `  const diagnosticPrevious = __bus58Normalization;
  if (typeof __bus58Observer === "function") {
    __bus58Normalization = { input, traces, generatedEscapes };
    __bus58Observe("normalization_start", { context: __bus58Normalization });
  }
  try {
  const replacements =`, "normalization scope start")
    const hardAnchor = "hard ??= [...fixedCopper(input), ...traces.flatMap(routeCopper)];"
    if (block.split(hardAnchor).length !== 3) throw new Error("Expected both native hard-list constructions")
    block = block.replaceAll(hardAnchor, 'hard ??= [...__bus58Copper("input_copper", fixedCopper(input)), ...traces.flatMap((diagnosticTrace) => __bus58Copper("original_carrier", routeCopper(diagnosticTrace), diagnosticTrace))];')
    anchors.push("both actual hard-list primitive constructions")
    block = replaceOnce(block,
      "        curvedSegments: void 0\n      });\n    hard ??=",
      `        curvedSegments: void 0
      });
    if (__bus58Normalization) __bus58Observe("escape_replacement_map", { context: __bus58Normalization, replacements });
    hard ??=`, "attached escape provenance")
    block = replaceOnce(block,
      "    if (result !== trace) hard.push(...routeCopper(result));\n    return result;",
      `    if (result !== trace) hard.push(...__bus58Copper("replacement_carrier", routeCopper(result), trace, result));
    if (__bus58Normalization) __bus58Observe("carrier_replaced", { context: __bus58Normalization, original: trace, replacement: result });
    return result;`, "carrier provenance")
    block = replaceOnce(block,
      "      hard.push(...routeCopper(normalized2));\n      return normalized2;",
      `      hard.push(...__bus58Copper("replacement_escape", routeCopper(normalized2), escape, normalized2));
      if (__bus58Normalization) __bus58Observe("escape_replaced", { context: __bus58Normalization, original: escape, replacement: normalized2 });
      return normalized2;`, "escape provenance")
    return replaceOnce(block,
      '    escapes\n  };\n}\n',
      `    escapes
  };
  } finally {
    if (__bus58Normalization) __bus58Observe("normalization_end", { context: __bus58Normalization });
    __bus58Normalization = diagnosticPrevious;
  }
}
`, "normalization scope release")
  })

  editFunction("function* finishSurfaceTiming(previous, options, policy = {}) {", "function* solveRefinement", block => {
    for (const [variable, reason] of [["matched", "initial_refinement"], ["extended", "package_coupling"], ["repaired", "package_coupling_repair"], ["rematched", "second_refinement"]]) {
      block = replaceOnce(block, `if (!${variable}) return null;`, `if (!${variable}) { __bus58Observe("surface_null", { reason: "${reason}", prepared, options, policy }); return null; }`, `surface null ${reason}`)
    }
    block = replaceOnce(block, "    if (!accepted()) return null;", `    if (!accepted()) { __bus58Observe("surface_null", { reason: "length_or_pair_report", prepared, options, policy }); return null; }`, "surface reports rejection")
    block = replaceOnce(block, "      if (!validator.solved) return null;", `      if (!validator.solved) { __bus58Observe("surface_null", { reason: "final_validator", prepared, options, policy, validator, steps }); return null; }`, "surface validation rejection")
    return replaceOnce(block, '  } catch {\n    return null;\n  }', `  } catch (diagnosticError) {
    __bus58Observe("surface_null", { reason: "caught_exception", prepared, options, policy, error: diagnosticError });
    return null;
  }`, "surface swallowed exception")
  })

  editFunction("function* finishGeneratedSurfaceCarriers(params) {", "function pruneCandidateDomains", block => {
    block = replaceOnce(block, "  if (!result) return null;", `  if (!result) { __bus58Observe("surface_null", { reason: "finish_timing_null", input, carriers, escapes, options, maxSteps }); return null; }`, "finishing timing null")
    return replaceOnce(block, '  ))\n    return null;', `  )) {
    __bus58Observe("surface_null", { reason: "final_joined_geometry", input, carriers: completedCarriers, escapes: result.escapes, traces });
    return null;
  }`, "finishing joined null")
  })

  editFunction("function* routeGeneratedSignalSites({", "function* negotiateGeneratedSignalSites", block => replaceOnce(block,
    "  if (!routed) return null;", `  if (!routed) { __bus58Observe("surface_null", { reason: "generated_site_negotiation", input, options, maxSteps }); return null; }`, "negotiation null"))

  editFunction("var BusLanesPipelineSolver = class", "// lib/utils/autorouting/BusLanesAutorouter.ts", block => {
    block = replaceOnce(block,
      '        if (!state.done) return;\n        this.surfaceFinishing = void 0;',
      `        if (!state.done) return;
        __bus58Observe("surface_done", { pipeline: this, state });
        this.surfaceFinishing = void 0;`, "surface completion before cleanup")
    block = replaceOnce(block,
      '          maxSteps: Math.max(1, this.MAX_ITERATIONS - this.iterations)\n        });\n        return;\n      }\n      this.phase = `lanes_',
      `          maxSteps: Math.max(1, this.MAX_ITERATIONS - this.iterations)
        });
        __bus58Observe("surface_start", { entry: "failed_lane_site_negotiation", pipeline: this });
        return;
      }
      this.phase = \`lanes_`, "failed child entry")
    return replaceOnce(block,
      '            maxSteps: Math.max(1, this.MAX_ITERATIONS - this.iterations)\n          });\n          return;\n        }\n        this.acceptGeneratedTraces(this.traces);',
      `            maxSteps: Math.max(1, this.MAX_ITERATIONS - this.iterations)
          });
          __bus58Observe("surface_start", { entry: "solved_lane_invalid_join", pipeline: this });
          return;
        }
        this.acceptGeneratedTraces(this.traces);`, "solved child entry")
  })

  return {
    source,
    proof: {
      originalSha256,
      instrumentedSha256: createHash("sha256").update(source).digest("hex"),
      originalByteLength: Buffer.byteLength(arguments[0]),
      instrumentedByteLength: Buffer.byteLength(source),
      observerSymbol: OBSERVER_SYMBOL,
      anchors,
      originalOptionsAndBudgetsUnchanged: true,
      extraOriginalPredicateEvaluations: 0,
      wallClockOutcomeParityGuaranteed: false,
    },
  }
}
