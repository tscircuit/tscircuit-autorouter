#!/usr/bin/env python3
"""Read-only original-server-ZIP proof and bounded raw accepted/no-op pair audit."""
import argparse
import copy
import hashlib
import importlib.util
import json
import math
from pathlib import Path, PurePosixPath
import re
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parent


def load(name, filename):
    s = importlib.util.spec_from_file_location(name, ROOT / filename)
    m = importlib.util.module_from_spec(s); s.loader.exec_module(m)
    return m


r = load('quality6_raw_runtime', 'run-witness-quality6.py')
c = load('quality6_raw_carrier', 'witness-quality6-artifact-carrier.py')
require, exact = r.require, r.exact


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read(archive, name):
    return json.loads(archive.read(name))


def owner_by_trace(report):
    result = {}
    for item in report['traceOwners']:
        require(item.get('status') == 'RESOLVED' and item.get('originalId') not in result, 'Unique complete original trace owner required')
        result[item['originalId']] = item['owner']
    return result


def selected_via_material(original, point_pairs, point):
    """Independent port of frozen getViaDimensions + converter override policy.

    Full manufactured layers follow original blind/buried policy, never just
    raw from/to endpoints. Unknown/invalid material cannot qualify a repair.
    """
    numeric = lambda value: type(value) in [int, float] and math.isfinite(value)
    for context in [original, point_pairs]:
        for key in ['minViaDiameter', 'minViaHoleDiameter', 'minViaPadDiameter', 'min_via_hole_diameter', 'min_via_pad_diameter']:
            if key in context: require(numeric(context[key]) and context[key] >= 0, 'Unprovable declared via dimension default')
    first = lambda values: next((v for v in values if numeric(v)), None)
    hole_request = first([point_pairs.get('min_via_hole_diameter'), point_pairs.get('minViaHoleDiameter')])
    pad_request = first([point_pairs.get('min_via_pad_diameter'), point_pairs.get('minViaPadDiameter'), point_pairs.get('minViaDiameter')])
    pad = max(pad_request if pad_request is not None else .3, hole_request if hole_request is not None else 0)
    diameter = original.get('minViaDiameter') if original.get('minViaDiameter') is not None else pad
    drill = next((v for v in [point_pairs.get('min_via_hole_diameter'), point_pairs.get('minViaHoleDiameter')] if v is not None), None)
    if drill is None: drill = diameter * .5 if 'minViaDiameter' in original else hole_request if hole_request is not None else pad * .5
    outer, hole = point.get('via_diameter', diameter), point.get('via_hole_diameter', drill)
    require(numeric(outer) and numeric(hole) and 0 < hole <= outer, 'Raw via effective diameter/drill is unsupported')
    count = original.get('layerCount')
    require(type(count) is int and 2 <= count <= 10, 'Raw via requires an explicit supported original stack')
    stack = ['top', *[f'inner{i}' for i in range(1, count - 1)], 'bottom']
    start, end = point.get('from_layer'), point.get('to_layer')
    require(start in stack and end in stack and start != end, 'Raw via layer transition is unsupported')
    low, high = sorted([stack.index(start), stack.index(end)])
    layers = point.get('layers', stack[low:high + 1]) if original.get('allowBlindAndBuriedVias') is True else stack
    require(isinstance(layers, list) and layers and all(isinstance(x, str) and x in stack for x in layers) and len(set(layers)) == len(layers) and start in layers and end in layers, 'Raw via full manufactured layer inventory is invalid')
    indices = sorted(stack.index(layer) for layer in layers)
    require(indices == list(range(indices[0], indices[-1] + 1)), 'Non-contiguous manufactured via span cannot qualify independent physical proof')
    return outer, hole, set(layers)


def mutation_mask(original, a, b, ca, cb, ra, rb, point_pairs=None):
    """All raw differences must be XY of one full coupled manufactured via site."""
    point_pairs = original if point_pairs is None else point_pairs
    require(not original.get('traces') and not any(x.get('circuitJsonMetadata', {}).get('pcb_via_id') for x in original.get('obstacles', [])), 'Fixed original copper is outside accepted-mask scope')
    require(isinstance(a, list) and len(a) == len(b), 'Raw trace population changed')
    owners = owner_by_trace(ra)
    require(exact(owners, owner_by_trace(rb)), 'Original trace ownership changed')
    changes = []
    for ti, (old, new) in enumerate(zip(a, b)):
        require(exact({k: v for k, v in old.items() if k != 'route'}, {k: v for k, v in new.items() if k != 'route'}) and not old.get('__replaces_pcb_trace_id'), 'Trace identity/material/protected metadata changed')
        require(len(old['route']) == len(new['route']), 'Raw route point population changed')
        for pi, (op, np) in enumerate(zip(old['route'], new['route'])):
            if exact(op, np): continue
            require(op.get('route_type') in ['wire', 'via'] and exact({k: v for k, v in op.items() if k not in ['x', 'y']}, {k: v for k, v in np.items() if k not in ['x', 'y']}), 'Only XY may change; primitive/layer/width/drill/IDs/metadata protected')
            require(0 < pi < len(old['route']) - 1 and 'start_pcb_port_id' not in op and 'end_pcb_port_id' not in op, 'Terminal occurrence moved')
            require(all(type(p.get(k)) in [int, float] and math.isfinite(p[k]) for p in [op, np] for k in ['x', 'y']), 'Invalid movement coordinate')
            changes.append((ti, pi, op, np))
    require(changes and any(op['route_type'] == 'via' for _, _, op, _ in changes), 'Accepted repair must have nonzero mapped via mutation')
    old_sites = {(p['x'], p['y']) for _, _, p, _ in changes}; new_sites = {(p['x'], p['y']) for _, _, _, p in changes}
    require(len(old_sites) == len(new_sites) == 1 and old_sites != new_sites, 'More than one coupled site moved')
    xy, nxy = next(iter(old_sites)), next(iter(new_sites))
    vias = lambda circuit, xy: [x for x in circuit if x.get('type') == 'pcb_via' and (x.get('x'), x.get('y')) == xy]
    va, vb = vias(ca, xy), vias(cb, nxy)
    # The pinned converter emits one alias for each globally first-seen
    # directed XY/from/to key, even when those aliases are one drill site.
    def inventory(traces, circuit):
        seen, sites, aliases = set(), {}, []
        for trace in traces:
            require(trace['pcb_trace_id'] in owners, 'Every raw trace requires a declared original owner')
            for point in trace['route']:
                if point.get('route_type') != 'via': continue
                require(all(type(point.get(k)) in [int, float] and math.isfinite(point[k]) for k in ['x', 'y']), 'Unsupported raw via coordinate')
                key = (point['x'], point['y'], point.get('from_layer'), point.get('to_layer'))
                outer, hole, span = selected_via_material(original, point_pairs, point)
                site = (owners[trace['pcb_trace_id']], outer, hole, span)
                require(key[:2] not in sites or exact(sites[key[:2]][:3], site[:3]) and sites[key[:2]][3] == span, 'Coincident raw via contributors have ambiguous owner/material/span')
                sites[key[:2]] = site
                if key in seen: continue
                identifier = 'via_' + str(len(seen)); seen.add(key)
                aliases.append({'id': identifier, 'trace': trace['pcb_trace_id'], 'outer': outer, 'hole': hole, 'span': span, 'xy': key[:2]})
        exported = [value for value in circuit if value.get('type') == 'pcb_via']
        require(len(exported) == len(aliases), 'Global raw directed-transition and canonical via inventory differ')
        for expected_alias, value in zip(aliases, exported):
            layers = value.get('layers')
            require(value.get('pcb_via_id') == expected_alias['id'] and value.get('pcb_trace_id') == expected_alias['trace'] and (value.get('x'), value.get('y')) == expected_alias['xy'], 'Global canonical via ID/order/first-trace/XY does not bind to its raw directed transition')
            require(value.get('outer_diameter') == expected_alias['outer'] and value.get('hole_diameter') == expected_alias['hole'] and isinstance(layers, list) and len(layers) == len(set(layers)) and set(layers) == expected_alias['span'], 'Global canonical via material/full span differs from raw contributors')
        return aliases
    all_aliases_a, all_aliases_b = inventory(a, ca), inventory(b, cb)
    expected_aliases = [value for value in all_aliases_a if value['xy'] == xy]
    require([value['id'] for value in expected_aliases] == [value['id'] for value in all_aliases_b if value['xy'] == nxy], 'Moved canonical aliases do not have the same exact global raw identities')
    require(expected_aliases and len(va) == len(vb) == len(expected_aliases), 'Selected raw directed transitions and canonical alias population differ')
    selected_ids = [value['id'] for value in expected_aliases]
    require([value.get('pcb_via_id') for value in va] == selected_ids == [value.get('pcb_via_id') for value in vb], 'Selected canonical aliases do not match exact native directed-transition IDs/order')
    for circuit in [ca, cb]:
        ids = [value.get('pcb_via_id') for value in circuit if value.get('type') == 'pcb_via']
        require(all(isinstance(value, str) for value in ids) and len(set(ids)) == len(ids), 'Canonical via identity is not unique')
    for expected_alias, old_alias, new_alias in zip(expected_aliases, va, vb):
        require(exact({k: v for k, v in old_alias.items() if k not in ['x', 'y']}, {k: v for k, v in new_alias.items() if k not in ['x', 'y']}), 'Selected canonical alias identity/material/drill/layers changed')
        require(old_alias.get('pcb_trace_id') == expected_alias['trace'] and owners.get(expected_alias['trace']) == owners[a[changes[0][0]]['pcb_trace_id']], 'Selected canonical alias does not prove its first raw trace and original owner')
        require(old_alias.get('outer_diameter') == expected_alias['outer'] and old_alias.get('hole_diameter') == expected_alias['hole'] and isinstance(old_alias.get('layers'), list) and set(old_alias['layers']) == expected_alias['span'], 'Selected alias material/full manufactured span differs from its exact raw transition')
    witnesses = [x for x in ra['allFindings'] if x.get('checkClass') == 'viaPad' and x.get('classification') == 'DECLARED_FOREIGN_COPPER' and any(o.get('type') == 'pcb_via' and o.get('id') in selected_ids for o in x.get('owners', []))]
    require(witnesses and len(witnesses) == len(ra['allFindings']), 'Moved raw via is not the exact isolated original-foreign witness site')
    layers = va[0]['layers']; require(isinstance(layers, list) and layers and all(isinstance(x, str) for x in layers) and len(set(layers)) == len(layers), 'Manufactured via span absent/ambiguous')
    moved_owner = owners[a[changes[0][0]]['pcb_trace_id']]
    expected, via_count = set(), 0
    for ti, trace in enumerate(a):
        for pi, p in enumerate(trace['route']):
            if (p.get('x'), p.get('y')) != xy: continue
            if p.get('route_type') == 'via' or (p.get('route_type') == 'wire' and p.get('layer') in layers):
                require(owners[trace['pcb_trace_id']] == moved_owner, 'Foreign same-site copper may not move')
                expected.add((ti, pi))
            if p.get('route_type') == 'via':
                via_count += 1
                outer, hole, manufactured = selected_via_material(original, point_pairs, p)
                require(outer == va[0]['outer_diameter'] and hole == va[0]['hole_diameter'] and manufactured == set(layers), 'Selected raw occurrence material/full manufactured span differs from canonical export')
                require(p.get('from_layer') in layers and p.get('to_layer') in layers, 'Via transition not covered by manufactured span')
                for q in [trace['route'][pi - 1] if pi > 0 else {}, trace['route'][pi + 1] if pi + 1 < len(trace['route']) else {}]:
                    require(q.get('route_type') == 'wire' and (q.get('x'), q.get('y')) == xy and q.get('layer') in layers, 'Via adjacency not exact coupled copper')
    require({(ti, pi) for ti, pi, _, _ in changes} == expected and via_count > 0, 'Not every coupled same-site/span occurrence moved together')
    changed_indices = {(ti, pi) for ti, pi, _, _ in changes}
    trace_indices = {trace['pcb_trace_id']: ti for ti, trace in enumerate(a)}
    require(len(trace_indices) == len(a), 'Raw trace identities are not unique')
    for circuit, traces in [(ca, a), (cb, b)]:
        canonical_traces = [value for value in circuit if value.get('type') == 'pcb_trace']
        require(len(canonical_traces) == len(traces) and {value.get('pcb_trace_id') for value in canonical_traces} == set(trace_indices), 'Canonical/raw trace inventory differs')
        for trace in canonical_traces:
            raw_trace = traces[trace_indices[trace['pcb_trace_id']]]
            require(isinstance(trace.get('route'), list) and len(trace['route']) == len(raw_trace['route']), 'Canonical/raw route population differs')
            for canonical_point, raw_point in zip(trace['route'], raw_trace['route']):
                fields = ['route_type', 'x', 'y', 'width', 'layer'] if raw_point.get('route_type') == 'wire' else ['route_type', 'x', 'y', 'from_layer', 'to_layer']
                require(raw_point.get('route_type') in ['wire', 'via'] and exact({key: canonical_point.get(key) for key in fields}, {key: raw_point.get(key) for key in fields}), 'Canonical route geometry differs from its exact raw point')
    def strip(value):
        if value.get('type') == 'pcb_via' and value.get('pcb_via_id') in selected_ids:
            return {key: item for key, item in value.items() if key not in ['x', 'y']}
        if value.get('type') == 'pcb_trace':
            ti = trace_indices[value['pcb_trace_id']]
            return {**value, 'route': [{key: item for key, item in point.items() if key not in ['x', 'y']} if (ti, pi) in changed_indices else point for pi, point in enumerate(value['route'])]}
        return value
    require(exact([strip(x) for x in ca], [strip(x) for x in cb]), 'Protected canonical geometry/metadata or unselected vias changed')
    return {'status': 'PASS_ONE_RAW_COUPLED_SITE_COORDINATE_ONLY', 'oldXY': list(xy), 'newXY': list(nxy), 'changedRawPoints': [[ti, pi] for ti, pi, _, _ in changes], 'rawViaOccurrences': via_count, 'originalForeignViaPadWitnessCount': len(witnesses), 'canonicalViaId': va[0]['pcb_via_id'], 'canonicalViaIds': selected_ids, 'canonicalViaAliasCount': len(selected_ids), 'exactNativeDirectedTransitionAliasBijection': True, 'canonicalTraceGeometryAndProtectedMetadataBound': True, 'manufacturedLayers': layers, 'originalOwner': moved_owner, 'selectedRawEffectiveMaterialAndFullSpanVerified': True, 'allOtherRawGeometryMaterialIdentityMetadataUnchanged': True, 'protectedCanonicalElementsUnchanged': True}


def bind_source_proposal(candidate, mask):
    """Bind the pinned source certificate branch to this exact exported move."""
    qualification = candidate['featureCoverage']['qualification']
    coordinates = [qualification.get('lastX'), qualification.get('lastY')]
    require(qualification.get('initialForeignViaPadFindings') == mask['originalForeignViaPadWitnessCount'], 'Source initial witness count differs from independent original-owner report')
    require(exact(coordinates, mask['newXY']), 'Source certified proposal coordinates differ from actual accepted export')
    return {'bound': True, 'sourceLastProposalXY': coordinates, 'exportedMutationXY': mask['newXY'], 'initialForeignWitnessCount': mask['originalForeignViaPadWitnessCount']}


def common_work(rows):
    fields = ['event', 'phaseName', 'activeSolverName', 'activeIterations', 'activeMaxIterations']
    values = []
    for row in rows:
        if row.get('phaseName') == r.STAGE: break
        if row.get('event') in ['phase_setup_enter', 'constructor_params_enter', 'constructor_params_exit', 'active_subsolver_constructed', 'phase_run_enter', 'on_solved_enter', 'on_solved_exit']:
            values.append({k: row.get(k) for k in fields})
    return values


def common_work_pair(rows):
    """Compare all named native work; account for only terminal dispatch.

    The enabled arm's common prefix ends before the new witness stage. The
    baseline's prefix instead includes its final empty phase-setup dispatch.
    Both full logs must prove that identical explicit terminal event before
    only the successful solve exit. No named phase or iteration is filtered.
    """
    fields = ['event', 'phaseName', 'activeSolverName', 'activeIterations', 'activeMaxIterations']
    terminal = dict(zip(fields, ['phase_setup_enter', None, None, None, None]))
    original = {arm: common_work(rows[arm]) for arm in 'AB'}
    adjusted = {arm: list(original[arm]) for arm in 'AB'}
    details = {'applied': False, 'originalCommonWorkCounts': {arm: len(original[arm]) for arm in 'AB'}}
    if not exact(original['A'], original['B']) and original['A'] and original['A'][-1] == terminal and (not original['B'] or original['B'][-1] != terminal):
        ends = {}
        for arm in 'AB':
            values = rows[arm]
            found = [(i, value) for i, value in enumerate(values) if value.get('event') == 'phase_setup_enter' and value.get('phaseName') is None]
            require(len(found) == 1, 'Exactly one terminal empty phase setup is required')
            index, value = found[0]
            require(index == len(values) - 2 and all(key in value for key in fields) and {key: value[key] for key in fields} == terminal, 'Only the explicit penultimate empty orchestration row may be accounted separately')
            final = values[-1]
            require(final.get('event') == 'solve_exit' and final.get('phaseName') is None and final.get('solved') is True and final.get('failed') is False and final.get('error') is None, 'Terminal empty dispatch must precede a successful solve exit')
            ends[arm] = {key: value[key] for key in fields}
        require(exact(ends['A'], ends['B']), 'Both terminal empty orchestration events must match')
        adjusted['A'] = adjusted['A'][:-1]
        require(all(exact([value for value in original[arm] if value.get('phaseName') is not None], [value for value in adjusted[arm] if value.get('phaseName') is not None]) for arm in 'AB'), 'Every named native phase work event must remain unchanged')
        details.update(applied=True, identicalTerminalNullRows=ends, droppedRows={'A': 1, 'B': 0}, allNamedNativePhaseWorkEventsUnchanged=True)
    details['correctedCommonWorkCounts'] = {arm: len(adjusted[arm]) for arm in 'AB'}
    details['commonNativePhaseWorkEqual'] = exact(adjusted['A'], adjusted['B'])
    return details


class ZipPath:
    def __init__(self, archive, name): self.archive, self.name = archive, name.rstrip('/')
    def __truediv__(self, name): return ZipPath(self.archive, self.name + '/' + str(name))
    def read_bytes(self): return self.archive.read(self.name)
    def read_text(self): return self.read_bytes().decode()


def bound_output(z, target, record, a):
    audit = record['official']['routingMetrics']['experimentAudit']; raw = target + 'raw/'
    require(exact(read(z, raw + 'capture-provenance.json'), audit), 'Raw terminal capture differs')
    compact = record['declaredIntentCopper']; hashes = {n: sha(z.read(raw + n)) for n in r.declared.INPUTS}
    require(exact(hashes, compact['inputHashes']) and hashes['original-input.json'] == record['expectedInputHash'], 'Original retained input hashes differ')
    report_bytes = z.read(raw + 'declared-intent-via-pad.json'); report = json.loads(report_bytes)
    require(sha(report_bytes) == compact['reportSha256'] and report.get('sidecarSourceSha256') == r.common.DECLARED_SOURCE_SHA256 and report.get('checker', {}).get('moduleSha256') == r.common.CHECKER_SOURCE_SHA256, 'Frozen seven-predicate report source/bytes differ')
    require(report.get('checksRun') == compact.get('checksRun') and len(report.get('checksRun', [])) == 7 and set(report['checksRun']) == r.declared.CHECKS and report.get('allPublishedCopperChecksRun') is True, 'Seven predicate coverage differs')
    for key in ['status', 'qualifiedSupportedCopper', 'ownershipCoverageStatus', 'geometryUnchanged', 'canonicalSemanticSha256', 'copperGeometrySha256', *r.declared.COUNTS]: require(exact(report.get(key), compact.get(key)), 'Full/compact declared report differs: ' + key)
    require(exact(report['inputHashes'], hashes) and sha(json.dumps(report['allFindings'], sort_keys=True, separators=(',', ':')).encode()) == compact['findingInventorySha256'], 'Finding inventory differs')
    for name in r.declared.CHECKS:
        require(exact({k: report['checks'][name][k] for k in ['count', 'knownForeignFindingCount', 'unknownFindingCount', 'sameOwnerRuleFindingCount']}, compact['perCheckCounts'][name]), 'Per-class seven report differs')
    require(hashes['canonical-circuit-json.json'] == compact['canonicalSemanticSha256'] == record['supplemental']['canonicalCircuitJsonSha256'] and hashes['raw-new-traces.json'] == audit['rawNewTracesHash'] and sha(z.read(raw + 'raw-solver-output.json')) == audit['rawOutputHash'], 'Output/canonical hash binding differs')
    supplemental = read(z, raw + 'supplemental-validation.json')
    require(exact(r.common.pinned.compact_checks(supplemental), record['supplemental']) and all(exact(supplemental.get(k), v) for k, v in audit.items()), 'Full supplemental/official terminal evidence differs')
    for name in r.CHECKS: require(len(supplemental[name]['errors']) == supplemental[name]['count'], 'Supplemental finding population differs')
    return {'original': read(z, raw + 'original-input.json'), 'pairs': read(z, raw + 'point-pair-context.json'), 'traces': read(z, raw + 'raw-new-traces.json'), 'output': read(z, raw + 'raw-solver-output.json'), 'canonical': read(z, raw + 'canonical-circuit-json.json'), 'declared': report, 'supplemental': supplemental}


def qualify_zip(z, parsed, m, a):
    case = parsed['case']; prefix = f"witness-via-pad-sample-{case['sample']:03d}-{case['dataset']}-{case['order']}/"
    names = z.namelist(); require(len(names) == len(set(names)) and all(not PurePosixPath(n).is_absolute() and '..' not in PurePosixPath(n).parts and n.startswith(prefix) for n in names), 'Duplicate/unsafe/foreign ZIP member')
    records = [json.loads(x) for x in z.read(prefix + 'results.jsonl').splitlines()]
    require(exact(records, parsed['records']) and exact(read(z, prefix + 'summary.json'), parsed['summary']), 'ZIP/log population differs')
    prov = read(z, prefix + 'provenance.json')
    require(exact(prov['manifest'], m) and prov['manifestSha256'] == r.sha(r.MANIFEST) and exact(prov['case'], case) and prov['githubRunId'] == parsed['runId'] and prov['controllerSha'] == parsed['controllerSha'] and prov['runAttempt'] == '1', 'ZIP provenance differs')
    require(prov['inputIdentity']['sampleNumber'] == case['sample'] and prov['inputIdentity']['inputHash'] == case['inputHash'], 'ZIP selected input differs')
    require(exact(r.common.pinned.compare_dependency_resolutions(prov['harnesses']), prov['dependencyComparison']), 'Dependency pair differs')
    outputs, checkpoints, facts = {}, {}, []
    for record in records:
        arm = record['arm']; expected = r.expected_cp(m, case, arm, parsed['runId'], parsed['controllerSha'])
        h = prov['harnesses'][arm]
        require(h['checkoutSha'] == record['sha'] and h['validators'] == a['expectedValidatorHashes'] and all(h.get(k) == v for k, v in a['expectedHarnessSourceHashes'].items()), 'Retained harness/validators differ')
        config = dict(a['baseline'], evidencePaths=r.PATHS) if arm == 'A' else dict(m['candidate']); config['phaseCheckpoint'] = expected
        require(exact(read(z, prefix + f'config-{arm}.json'), config), 'Retained config differs')
        target = prefix + f'pair-1/{arm}/'; require(exact(read(z, target + 'audit-result.json'), record), 'Audit record differs')
        official = read(z, target + 'benchmark-result.json'); require(exact(official['tests'], [record['official']]) and exact(official['runtime'], record['officialReportRuntime']), 'Official report differs')
        cp = r.common.checkpoint_audit(ZipPath(z, target + 'raw'), expected); require(exact(cp, record['phaseCheckpointAudit']) and cp['errors'] == [], 'Raw synchronous checkpoint audit differs')
        checkpoints[arm] = [json.loads(x) for x in z.read(target + 'raw/phase-checkpoints.jsonl').splitlines()]
        if record['official']['didSolve'] is True: outputs[arm] = bound_output(z, target, record, a)
        facts.append({'arm': arm, 'strictIntegrityQualified': record['strictIntegrityQualified'], 'sourceQualified': r.source_qualified(record), 'official': {k: record['official'][k] for k in ['didSolve', 'didTimeout', 'relaxedDrcPassed']}, 'feature': record['featureCoverage'], 'rawCompletedOutputBound': arm in outputs})
    require(set(record['arm'] for record in records) == set('AB') and len(records) == 2, 'Both attempts required')
    work_comparison = common_work_pair(checkpoints)
    work_equal = work_comparison['commonNativePhaseWorkEqual']
    state = parsed['summary']['candidateState']; quality, mask, no_op, proposal_binding = False, None, None, None
    if set(outputs) == set('AB'):
        oa, ob = outputs['A'], outputs['B']; require(exact(oa['original'], ob['original']) and exact(oa['pairs'], ob['pairs']), 'Original intent or native point-pair work changed')
        if state == 'NO_PROPOSAL':
            no_op = exact(r.output_hashes(records[0]), r.output_hashes(records[1])) and exact(r.reports(records[0]), r.reports(records[1])) and all(exact(oa[k], ob[k]) for k in ['original', 'pairs', 'traces', 'output', 'canonical', 'declared'])
            require(no_op and work_equal, 'NO_PROPOSAL must preserve exact output/report/native work')
            quality = all(r.common.physical_clean(x) and r.source_qualified(x) for x in records) and next(x for x in records if x['arm'] == 'B')['featureCoverage']['qualification']['initialCertificateStatus'] == 'PASS'
        elif state == 'ACCEPTED':
            mask = mutation_mask(oa['original'], oa['traces'], ob['traces'], oa['canonical'], ob['canonical'], oa['declared'], ob['declared'], oa['pairs'])
            require(exact({k: v for k, v in oa['output'].items() if k != 'traces'}, {k: v for k, v in ob['output'].items() if k != 'traces'}) and exact(oa['output']['traces'], oa['traces']) and exact(ob['output']['traces'], ob['traces']), 'Exact public output/protected export differs')
            candidate = next(x for x in records if x['arm'] == 'B')
            proposal_binding = bind_source_proposal(candidate, mask)
            quality = all(r.source_qualified(x) for x in records) and r.common.physical_clean(candidate) and candidate['featureCoverage']['sourceFinalCertificatePassBranch'] is True and work_equal
    comparisons = {name: {arm: outputs[arm]['declared']['checks'][name] for arm in outputs} for name in sorted(r.declared.CHECKS)}
    ownership = {arm: {key: outputs[arm]['declared'].get(key) for key in ['ownershipCoverageStatus', 'unknownViaCount', 'unknownPadCount', 'unknownTraceCount', 'viaOwners', 'padOwners', 'traceOwners']} for arm in outputs}
    return {'sevenPredicateComparisons': comparisons, 'originalOwnershipComparisons': ownership, 'status': 'PASS_ORIGINAL_SERVER_ZIP_ALL_ATTEMPTS_BYTE_BOUND', 'recordsAudit': facts, 'commonNativePhaseWorkEqual': work_equal, 'terminalNullOrchestrationComparison': work_comparison, 'rawMutationMask': mask, 'sourceProposalBinding': proposal_binding, 'noProposalOutputAndReportParity': no_op, 'wholeOutputQualityCredit': quality, 'candidateState': state, 'sourceCertificateScope': 'Pinned source final certificate: published seven predicates, original reference/SRJ/via policy, conservative declared-terminal physical-contact graph; not universal manufacturing.', 'allSevenReportsCompared': set(outputs) == set('AB'), 'reports': {arm: r.reports(next(x for x in records if x['arm'] == arm)) for arm in outputs}, 'failedOrRejectedWitnessReductionIsFinalQualityCredit': False}


def main():
    p = argparse.ArgumentParser()
    for key in ['job-log', 'raw-zip', 'run-metadata', 'artifact-metadata', 'job-metadata', 'carrier-logs', 'output']: p.add_argument('--' + key, type=Path, required=True)
    p.add_argument('--producer-job-id', type=int, required=True); p.add_argument('--dataset', choices=['srj18', 'srj24'], required=True); p.add_argument('--sample', type=int, required=True); p.add_argument('--run-id', required=True); p.add_argument('--controller-sha', required=True)
    args = p.parse_args(); m, a = r.validate(); case = r.select_case(m, args.dataset, args.sample)
    require(not args.output.exists(), 'Never overwrite a qualification receipt')
    parsed = r.parse_log(args.job_log.read_text(), m, a, case, args.run_id, args.controller_sha)
    run = json.loads(args.run_metadata.read_text()); jobs_data = json.loads(args.job_metadata.read_text()); artifacts_data = json.loads(args.artifact_metadata.read_text()); logs = json.loads(args.carrier_logs.read_text())
    jobs = jobs_data['jobs']; artifacts = artifacts_data['artifacts']; source = c.run_pin(run, run_id=args.run_id, controller_sha=args.controller_sha, repository=c.REPOSITORY)
    require(source['run_attempt'] == 1 and jobs_data['runId'] == artifacts_data['runId'] == args.run_id, 'External API metadata population differs')
    name = f"witness-quality6-raw-witness-via-pad-sample-{case['sample']:03d}-{case['dataset']}-{case['order']}"
    matches = [x for x in artifacts if x.get('name') == name]; require(len(matches) == 1, 'Exact original raw artifact missing/duplicate'); artifact = matches[0]; pin = c.artifact_pin(artifact, source)
    producer = [x for x in jobs if x.get('id') == args.producer_job_id]; require(len(producer) == 1, 'Producer job missing/duplicate'); producer = producer[0]
    require(producer.get('name') == f"witness-quality6 / {case['dataset']} / {case['sample']} / {case['order']}" and str(producer.get('run_id')) == args.run_id and producer.get('head_sha') == args.controller_sha and producer.get('run_attempt') == 1 and producer.get('status') == 'completed', 'Producer job lineage differs')
    for label in ['Verify source trees and unchanged current-main validators', 'Verify complete installed pinned dependency source bytes', 'Build baseline', 'Build candidate', 'Prepare identical current-main harness and bounded observer', 'Retain exact inputs, output copper, checks, stage evidence and failures separately']:
        require(len([x for x in producer['steps'] if x.get('name') == label and x.get('conclusion') == 'success']) == 1, 'Producer source/build/run/upload step not successful: ' + label)
    require(len([x for x in producer['steps'] if x.get('name') == 'Run one fresh pair in the exact predeclared case order' and x.get('conclusion') in ['success', 'failure']]) == 1, 'Attempt step missing; native/source failures must remain exposed')
    finalized, last_digest = [], None
    for line in args.job_log.read_text().splitlines():
        line = re.sub(r'^\ufeff?(?:\d{4}-\d{2}-\d{2}T\S+Z\s+)?', '', line)
        match = re.fullmatch(r'SHA256 digest of uploaded artifact zip is ([0-9a-f]{64})', line)
        if match: last_digest = match[1]
        match = re.fullmatch(r'Artifact ' + re.escape(name) + r'\.zip successfully finalized\. Artifact ID ([0-9]+)', line)
        if match: finalized.append((int(match[1]), last_digest))
    require(finalized == [(artifact['id'], pin['whole_sha256'])], 'Producer upload ID/name/original ZIP digest not associated')
    count = (pin['whole_bytes'] + c.PART_BYTES - 1) // c.PART_BYTES
    carrier_jobs = [x for x in jobs if x.get('name') in {c.job_name(pin['artifact_id'], i) for i in range(count)}]
    require(args.raw_zip.stat().st_size == pin['whole_bytes'] and sha(args.raw_zip.read_bytes()) == pin['whole_sha256'], 'Given raw ZIP is not original API server ZIP')
    with tempfile.TemporaryDirectory(prefix='quality6-raw-proof-') as temporary:
        receipt = c.restore(logs, Path(temporary) / 'original.zip', expected_artifact=artifact, expected_run=run, expected_jobs=carrier_jobs, expected_manifest_sha256=r.sha(r.MANIFEST))
        require((Path(temporary) / 'original.zip').read_bytes() == args.raw_zip.read_bytes(), 'Authenticated carrier reconstruction differs from original ZIP')
    with zipfile.ZipFile(args.raw_zip) as z: result = qualify_zip(z, parsed, m, a)
    result.update(campaign=r.CAMPAIGN, case=case, runId=args.run_id, controllerSha=args.controller_sha, manifestSha256=r.sha(r.MANIFEST), rawZipSha256=pin['whole_sha256'], producerJobId=args.producer_job_id, artifactPin=pin, authenticatedCarrierReceipt=receipt, inputEvidenceSha256={key: sha(getattr(args, key.replace('-', '_')).read_bytes()) for key in ['job-log', 'run-metadata', 'artifact-metadata', 'job-metadata', 'carrier-logs']}, speedClaim=False, heldOut=False, fullPopulationSweep=False)
    args.output.write_text(json.dumps(result, indent=2) + '\n'); print(json.dumps({k: result[k] for k in ['status', 'case', 'wholeOutputQualityCredit', 'candidateState']}))


if __name__ == '__main__': main()
