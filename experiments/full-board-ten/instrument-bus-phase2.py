#!/usr/bin/env python3
"""Instrument exact published Core JS for observation; never execute routing.

Usage: instrument-core.py SOURCE[.gz] DEST[.gz]
Writes atomically only after every bounded, unique replacement matches.
The external observer is globalThis.__busDiag(type, data). Metadata includes
counts even when example events are capped. Original geometry predicates are
evaluated once, in their original short-circuit order.
"""
import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile

HELPERS = r'''
// Diagnostic-only hooks; no routing policy changes or extra geometry queries.
var __busDiagSequence = 0;
var __busDiagNegotiation = null;
var __busDiagSearchIds = new WeakMap();
var __busDiagMetadata = { counts: Object.create(null), errors: [] };
var __busDiagLocation = {};
function __busDiag(type, data) {
  try {
    __busDiagMetadata.counts[type] = (__busDiagMetadata.counts[type] ?? 0) + 1;
    if (data?.name) __busDiagLocation = {type, name: data.name, layer: data.layer, end: data.end, alignSurfaceGrid: data.alignSurfaceGrid, call: data.call};
    globalThis.__busDiag?.(type, data);
  } catch (error) {
    if (__busDiagMetadata.errors.length < 20) __busDiagMetadata.errors.push(String(error));
  }
}
function __busDiagReject(value, type, data) {
  if (value) __busDiag(type, data);
  return value;
}
function* routeGeneratedSignalSites(request) {
  const call = ++__busDiagSequence;
  let completed = false;
  let yields = 0;
  __busDiag("generated_sites:start", {call, input: request.input, options: request.options, maxSteps: request.maxSteps});
  const inner = __busDiagOriginalRouteGeneratedSignalSites(request);
  const delegated = {
    [Symbol.iterator]() { return this; },
    next(value) { const step = inner.next(value); if (!step.done) yields++; return step; },
    return(value) { return inner.return(value); },
    throw(error) { return inner.throw(error); }
  };
  try {
    const result = yield* delegated;
    completed = true;
    __busDiag("generated_sites:return", {call, returned: !!result, yields, carriers: result?.carriers.length ?? 0, traces: result?.traces.length ?? 0, escapes: result?.escapes.length ?? 0});
    return result;
  } finally {
    if (!completed) __busDiag("generated_sites:cancelled_or_threw", {call, yields});
  }
}
'''



def instrument(source, control=False):
    if '__busDiag' in source:
        raise ValueError('Source already contains diagnostic hooks')
    changes = []
    exports = '\nexport { routeGeneratedSignalSites as __busDiagGeneratedSites, BusLanesPipelineSolver as __busDiagPipeline, getBusLanesInputFromSrj as __busDiagAdapt, GridComponents as __busDiagGridComponents, __busDiagSearchIds, __busDiagMetadata as busDiagMetadata };\n'
    if control:
        old = 'function* routeGeneratedSignalSites(request) {'
        if source.count(old) != 1 or source.count('function getBusLanesInputFromSrj(') != 1:
            raise ValueError('Expected exact generated-sites entry point and adapter')
        source = source.replace(old, 'function* __busDiagOriginalRouteGeneratedSignalSites(request) {')
        return HELPERS + source + exports, [{'block': 'control', 'match': old, 'count': 1}]

    def edit_block(start, end, callback):
        nonlocal source
        if source.count(start) != 1:
            raise ValueError(f'Nonunique block start: {start}')
        a = source.index(start)
        b = source.index(end, a + len(start))
        block = source[a:b]

        def replace(old, new, count=1):
            nonlocal block
            actual = block.count(old)
            if actual != count:
                raise ValueError(f'{start}: expected {count}, found {actual}: {old[:110]!r}')
            block = block.replace(old, new)
            changes.append({'block': start, 'match': old[:100], 'count': count})

        callback(replace)
        source = source[:a] + block + source[b:]

    def negotiation(r):
        r('  if (!remove.size) return null;', '  const __call = ++__busDiagSequence;\n  __busDiagNegotiation = __call;\n  __busDiag("negotiation.begin", {call: __call, options, stopWithOneRemaining, expandNonNativeSites, names: [...remove]});\n  if (!remove.size) return null;')
        r('    const choices = previous ? [previous.option] : [];', '    __busDiag("local.sites", {call: __call, name: connection.name, layers: carrierLayers, sites: ends.map(sites => sites.map(site => site.point))});\n    const choices = previous ? [previous.option] : [];')
        r('      } catch {\n      }\n      yield;', '      } catch {\n        __busDiag("local.dogbone_failed", {call: __call, name: connection.name, variant});\n      }\n      yield;')
        r('          const search = new GridVisibilitySearch(', '          __busDiag("local.search_begin", {call: __call, name: connection.name, layer});\n          const search = new GridVisibilitySearch(')
        r('            if (search.solved) {', '            __busDiag("local.search", {call: __call, searchId: __busDiagSearchIds.get(search), name: connection.name, layer, solved: search.solved, failed: search.failed, steps, expanded: search.expanded, start: a2.point, endPoint: b2.point});\n            if (search.solved) {')
        r('    for (const layer of carrierLayers) {\n      if (options.allowExpandedSites', '    __busDiag("domain.local", {call: __call, name: connection.name, layers: choices.map(choice => choice.layer)});\n    for (const layer of carrierLayers) {\n      if (options.allowExpandedSites')
        r('        allowPadEdgeSites: options.allowPadEdgeSites\n      });', '        allowPadEdgeSites: options.allowPadEdgeSites\n      });\n      __busDiag("domain.expanded", {call: __call, name: connection.name, layer, count: expanded.length});')
        r('    choices.sort((a2, b2) => a2.length - b2.length);', '    __busDiag("domain.final", {call: __call, name: connection.name, layers: choices.map(choice => choice.layer), lengths: choices.map(choice => choice.length)});\n    choices.sort((a2, b2) => a2.length - b2.length);')
        r('    if (!choices.length) {', '    if (!choices.length) {\n      __busDiag("negotiation.empty_domain", {call: __call, name: connection.name});')
        r('      (index2) => options.onBlockedConnection?.(entries[index2][0])', '      (index2) => { __busDiag("negotiation.pruned_domain", {call: __call, name: entries[index2][0], before: entries.map(([name, choices]) => [name, choices.length])}); return options.onBlockedConnection?.(entries[index2][0]); }')
        r('    if (!domains) return null;', '    if (!domains) return null;\n    __busDiag("negotiation.domains_pruned", {call: __call, domains: entries.map(([name], i) => [name, domains[i].length])});')
        r('  const finish = () => {', '  const finish = () => {\n    __busDiag("negotiation.complete", {call: __call, names: [...routed.keys()]});')
        r('  return routed.size === base.connections.length ? finish() : null;', '  __busDiag("negotiation.end", {call: __call, routed: [...routed.keys()], remaining: queue.map(c => c.name), pools: [...pools2].map(([name, pool]) => [name, pool.length])});\n  return routed.size === base.connections.length ? finish() : null;')

    edit_block('function* negotiateSignalSites(', '\nvar EXPANDED_GRID_PROBE_STEPS', negotiation)

    def sites(r):
        r('  const ends = [[], []];', '  const __call = __busDiagNegotiation;\n  const __site = {call: __call, name: connection.name, layer: targetLayer2, allowPadEdgeSites};\n  __busDiag("sites.begin", __site);\n  const ends = [[], []];')
        r('    const pad = connection.pointsToConnect[end];', '    const pad = connection.pointsToConnect[end];\n    const __end = {...__site, end, pad};')
        r('    if (!owner) continue;', '    if (!owner) { __busDiag("site.no_owner", __end); continue; }')
        r('    if (!Number.isFinite(pitch)) continue;', '    if (!Number.isFinite(pitch)) { __busDiag("site.no_pitch", __end); continue; }')
        r('      if (alignSurfaceGrid && ends[end].length) break;', '      if (alignSurfaceGrid && ends[end].length) { __busDiag("site.skip_aligned", {...__end, accepted: ends[end].map(site => site.point)}); break; }')
        r('        if (index2 === gridCandidateCount && ends[end].length) break;', '        if (index2 === gridCandidateCount && ends[end].length) { __busDiag("site.skip_pad_edge", {...__end, alignSurfaceGrid, accepted: ends[end].map(site => site.point), omitted: candidates.slice(index2)}); break; }\n        const __candidate = {...__end, point: point52, alignSurfaceGrid, siteKind: index2 < gridCandidateCount ? "grid" : "pad_edge"};')
        r('        if (viaScenes.some((scene2) => !scene2.visible(point52, point52))) continue;', '        if (__busDiagReject(viaScenes.some((scene2) => !scene2.visible(point52, point52)), "site.via_clearance", __candidate)) continue;')
        r('        if (existingVias.some(', '        if (__busDiagReject(existingVias.some(')
        r(' / 2 + holeClearance - 1e-8\n        ))\n          continue;', ' / 2 + holeClearance - 1e-8\n        ), "site.existing_drill", __candidate))\n          continue;')
        r('        const search = new GridVisibilitySearch(', '        __busDiag("site.search_begin", {...__candidate, maxLength: surfaceLimit, explicitBounds: surfaceGrid.bounds ?? null});\n        const search = new GridVisibilitySearch(')
        r('          if (!search.solved) continue;', '          if (!search.solved) { __busDiag("site.search_failed", {...__candidate, searchId: __busDiagSearchIds.get(search), failed: search.failed, steps, expanded: search.expanded}); continue; }\n          __busDiag("site.search_complete", {...__candidate, searchId: __busDiagSearchIds.get(search), steps, expanded: search.expanded});')
        r('!scene.pathVisible(top)', '__busDiagReject(!scene.pathVisible(top), "site.path_visibility", __candidate)')
        r('length(top) > surfaceLimit + 1e-8', '__busDiagReject(length(top) > surfaceLimit + 1e-8, "site.length", __candidate)')
        r('!routeAnglesAreConventional([{ ...topTrace, route: top }])', '__busDiagReject(!routeAnglesAreConventional([{ ...topTrace, route: top }]), "site.angles", __candidate)')
        r('!tuningPathIsSelfClear(\n            top,\n            width + (input.minTraceToPadEdgeClearance ?? input.defaultObstacleMargin ?? 0.075)\n          )', '__busDiagReject(!tuningPathIsSelfClear(\n            top,\n            width + (input.minTraceToPadEdgeClearance ?? input.defaultObstacleMargin ?? 0.075)\n          ), "site.self_clearance", __candidate)')
        r('          const via = {', '          __busDiag("site.accepted", {...__candidate, path: top});\n          const via = {')
        r('  return ends;\n}', '  __busDiag("sites.end", {...__site, sites: ends.map(sites => sites.map(site => ({point: site.point, length: site.length})))});\n  return ends;\n}')

    edit_block('function* expandedSignalSites(', '\nfunction innerCarrier(', sites)

    def pairs(r):
        r('  const ends = yield* expandedSignalSites({', '  const __pair = {call: __busDiagNegotiation, name: connection.name, layer: targetLayer2, allowPadEdgeSites};\n  const ends = yield* expandedSignalSites({')
        r('  if (ends.some((sites) => !sites.length)) return [];', '  if (ends.some((sites) => !sites.length)) { __busDiag("pair.empty_domain", {...__pair, sizes: ends.map(sites => sites.length)}); return []; }')
        r('      if (!search.solved) break;', '      if (!search.solved) { __busDiag("pair.search_failed", {...__pair, searchId: __busDiagSearchIds.get(search), sizes: available.map(sites => sites.length), failed: search.failed, expanded: search.expanded, steps}); break; }\n      __busDiag("pair.search_complete", {...__pair, searchId: __busDiagSearchIds.get(search), steps, expanded: search.expanded});')
        r('      available[end].splice(available[end].indexOf(used), 1);', '      available[end].splice(available[end].indexOf(used), 1);\n      const __selected = {...__pair, a: a2.point, b: b2.point, removedEnd: end, remaining: available.map(sites => sites.length)};\n      __busDiag("pair.selected", __selected);')
        r('if (generatedEscapeHolesConflict(input, [a2.escape], [b2.escape])) continue;', 'if (__busDiagReject(generatedEscapeHolesConflict(input, [a2.escape], [b2.escape]), "pair.drill", __selected)) continue;')
        r('!scene.pathVisible(route)', '__busDiagReject(!scene.pathVisible(route), "pair.path_visibility", __selected)')
        r('!routeAnglesAreConventional([{ ...carrier, route }])', '__busDiagReject(!routeAnglesAreConventional([{ ...carrier, route }]), "pair.angles", __selected)')
        r('!tuningPathIsSelfClear(\n        route,\n        width + (input.minTraceToPadEdgeClearance ?? input.defaultObstacleMargin ?? 0.075)\n      )', '__busDiagReject(!tuningPathIsSelfClear(\n        route,\n        width + (input.minTraceToPadEdgeClearance ?? input.defaultObstacleMargin ?? 0.075)\n      ), "pair.self_clearance", __selected)')
        r('      choices.push({', '      __busDiag("pair.accepted", {...__selected, route});\n      choices.push({')
        r('  return choices;', '  __busDiag("pairs.end", {...__pair, attempts, count: choices.length, remaining: available.map(sites => sites.length)});\n  return choices;')

    edit_block('function* expandedSignalSiteChoices(', '\nfunction* expandedSignalSites(', pairs)

    def grid(r):
        r('    super(scene, grid3);', '    const __gridLocation = {...__busDiagLocation};\n    __busDiag("grid.begin", {name: scene.connection.name, layer: scene.connection.pointsToConnect[0].layer, maxLength: grid3?.maxLength ?? null, explicitBounds: grid3?.bounds ?? null, location: __gridLocation});\n    const __gridStarted = performance.now();\n    super(scene, grid3);\n    try {')
        r('    const attach = (p2) => {', '    const __grid = {call: __busDiagNegotiation, search: ++__busDiagSequence, name: scene.connection.name, layer: scene.connection.pointsToConnect[0].layer, start, end, checkReachability: !!grid3?.checkReachability, step: this.stepSize, nx: this.nx, ny: this.ny};\n    __grid.searchId = __grid.search;\n    __busDiagSearchIds.set(this, __grid.search);\n    const attach = (p2) => {')
        r('      if (attachments.has(key)) return structuredClone(attachments.get(key));', '      if (attachments.has(key)) { __busDiag("grid.attachments_cache", {...__grid, point: p2, retained: attachments.get(key).map(a => ({id: a.id, path: a.path})), untruncated: "unknown"}); return structuredClone(attachments.get(key)); }')
        r('      const result = candidates.sort((a3, b3) => length(a3.path) - length(b3.path) || a3.id - b3.id).slice(0, 8);', '      const result = candidates.sort((a3, b3) => length(a3.path) - length(b3.path) || a3.id - b3.id).slice(0, 8);\n      __busDiag("grid.attachments", {...__grid, point: p2, candidates: candidates.map(a => ({id: a.id, path: a.path})), retained: result.map(a => a.id)});')
        r('    if (!a2 || !z23) {', '    if (!a2 || !z23) {\n      __busDiag("grid.constructor_failed", {...__grid, reason: !a2 ? "no_start_attachment" : "no_end_attachment", startCount: this.startAttachments.length, endCount: this.endAttachments.length});')
        r('      if (!sameComponent(this.startAttachments, this.endAttachments)) {', '      if (!sameComponent(this.startAttachments, this.endAttachments)) {\n        __busDiag("grid.constructor_failed", {...__grid, reason: "no_shared_retained_component", starts: this.startAttachments.map(a => a.id), ends: this.endAttachments.map(a => a.id)});')
        # Report attachment counts without reading occupancy rasters or lazy components.
        r('    const a2 = this.startAttachments[0], z23 = this.endAttachments[0];', '    __busDiag("grid.attachment_context", {...__grid, startCount: this.startAttachments.length, endCount: this.endAttachments.length});\n    const a2 = this.startAttachments[0], z23 = this.endAttachments[0];')

    # The following declaration starts the next bundled module and bounds edits.
    start = source.index('var GridVisibilitySearch = class')
    match = re.search(r'\n(?:function|var) ', source[start + 1:])
    if not match:
        raise ValueError('Missing GridVisibilitySearch successor')
    end_at = start + 1 + match.start()
    end_marker = source[end_at:source.index('\n', end_at + 1)]
    grid_block = source[start:end_at]
    # The next class method begins after the constructor; wrap all normal and
    # early-return exits so failed constructors contribute to timing totals.
    constructor_boundary = '\n  }\n  start;'
    if grid_block.count(constructor_boundary) != 1:
        raise ValueError('Missing exact constructor end')
    def timed_grid(r):
        grid(r)
        r(constructor_boundary, '\n    } finally {\n      __busDiag("grid.constructed", {name: scene.connection.name, layer: scene.connection.pointsToConnect[0].layer, elapsedMs: performance.now() - __gridStarted, cells: this.nx * this.ny, nx: this.nx, ny: this.ny, bounds: this.gridBounds, explicitBounds: grid3?.bounds ?? null, maxLength: grid3?.maxLength ?? null, step: this.stepSize, solved: this.solved, failed: this.failed, location: __gridLocation});\n    }' + constructor_boundary)
    edit_block('var GridVisibilitySearch = class', end_marker, timed_grid)

    def bounded(r):
        r('  let state = generator.next();', '  const __bound = ++__busDiagSequence;\n  __busDiag("bounded.begin", {id: __bound, limit, location: __busDiagLocation});\n  let state = generator.next();')
        r('    if (!state.done) generator.return(null);', '    __busDiag("bounded.end", {id: __bound, limit, steps, done: state.done, returned: !!state.value, location: __busDiagLocation});\n    if (!state.done) generator.return(null);')
    edit_block('function* runBoundedRouting(', '\nfunction shortenPairApproaches(', bounded)

    def generated(r):
        r('  const routed = yield* runBoundedRouting(', '  __busDiag("generated.pass", {expandAllGridSites, maxSteps});\n  const routed = yield* runBoundedRouting(')
        r('    const expandEmptyDomainsOnly = !expandAllGridSites && !allowPadEdgeSites;', '    const expandEmptyDomainsOnly = !expandAllGridSites && !allowPadEdgeSites;\n    __busDiag("generated.subpass", {expandAllGridSites, allowPadEdgeSites, expandEmptyDomainsOnly});')
    edit_block('function* completeGeneratedSignalSites(', '\nvar MAX_TOPOLOGY_STEPS', generated)

    old = 'function* routeGeneratedSignalSites(request) {'
    if source.count(old) != 1:
        raise ValueError('Expected one generated-sites entry point')
    source = source.replace(old, 'function* __busDiagOriginalRouteGeneratedSignalSites(request) {')
    if source.count('function getBusLanesInputFromSrj(') != 1:
        raise ValueError('Missing exact Core adapter')
    source = HELPERS + source + exports
    return source, changes


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('dest', type=Path)
    parser.add_argument('--control', action='store_true', help='Only expose internals and observe the generated-sites wrapper')
    args = parser.parse_args()
    if args.source.resolve() == args.dest.resolve():
        parser.error('Destination must differ from source')
    raw = gzip.decompress(args.source.read_bytes()) if args.source.suffix == '.gz' else args.source.read_bytes()
    assert hashlib.sha256(raw).hexdigest() == '9dbc237005e3a517d804d7661abd1a2d4519b7b678abac237d636ad8d84d26d6'
    output, changes = instrument(raw.decode(), args.control)
    encoded = output.encode()
    if args.dest.suffix == '.gz':
        encoded = gzip.compress(encoded, mtime=0)
    args.dest.parent.mkdir(parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(prefix='.instrument-', dir=args.dest.parent)
    try:
        with os.fdopen(fd, 'wb') as handle:
            handle.write(encoded)
        os.replace(temp, args.dest)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)
    print(json.dumps({'sourceSha256': hashlib.sha256(raw).hexdigest(), 'instrumentedSha256': hashlib.sha256(output.encode()).hexdigest(), 'replacementCount': len(changes), 'output': str(args.dest), 'bytes': len(encoded), 'changes': changes}))


if __name__ == '__main__':
    main()
