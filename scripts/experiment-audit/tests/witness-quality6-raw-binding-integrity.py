#!/usr/bin/env python3
"""One synthetic original-ZIP contents test; no physical checker or router execution."""
import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parent.parent
s = importlib.util.spec_from_file_location('quality6_raw_test_helpers', ROOT / 'tests/witness-quality6-integrity.py')
t = importlib.util.module_from_spec(s); s.loader.exec_module(t)
r, q = t.r, t.raw


def encoded(value):
    return json.dumps(value, separators=(',', ':')).encode()


def main():
    m, a = r.validate(); m, a = copy.deepcopy(m), copy.deepcopy(a)
    original = {'layerCount': 2, 'obstacles': [], 'connections': []}
    traces = [{'pcb_trace_id': 't', 'connection_name': 'N', 'route': [{'route_type': 'wire', 'x': -1, 'y': 0, 'width': .1, 'layer': 'top'}, {'route_type': 'wire', 'x': 1, 'y': 0, 'width': .1, 'layer': 'top'}]}]
    canonical = [{'type': 'pcb_trace', **traces[0]}]
    output = {**original, 'traces': traces}
    case = m['cases'][0]; case['inputHash'] = q.sha(encoded(original)); a['expectedInputHashesByDataset'][case['dataset']][str(case['sample'])] = case['inputHash']
    prefix = f"witness-via-pad-sample-{case['sample']:03d}-{case['dataset']}-{case['order']}/"
    files, rows = {}, []
    def put(name, value): files[prefix + name] = encoded(value)
    for arm in case['order']:
        record = t.make(m, a, case, arm); target = f'pair-1/{arm}/'; raw = target + 'raw/'
        for name, value in [('original-input.json', original), ('point-pair-context.json', original), ('raw-new-traces.json', traces), ('canonical-circuit-json.json', canonical), ('raw-solver-output.json', output)]: put(raw + name, value)
        hashes = {n: q.sha(files[prefix + raw + n]) for n in r.declared.INPUTS}
        report = copy.deepcopy(record['declaredIntentCopper'])
        report.update(inputHashes=hashes, canonicalSemanticSha256=hashes['canonical-circuit-json.json'], checks={n: {'count': 0, 'knownForeignFindingCount': 0, 'unknownFindingCount': 0, 'sameOwnerRuleFindingCount': 0, 'findings': []} for n in r.declared.CHECKS}, allFindings=[], traceOwners=[{'originalId': 't', 'owner': 'O', 'status': 'RESOLVED'}], padOwners=[], viaOwners=[])
        put(raw + 'declared-intent-via-pad.json', report)
        compact = record['declaredIntentCopper']; compact.update(inputHashes=hashes, canonicalSemanticSha256=hashes['canonical-circuit-json.json'], reportSha256=q.sha(files[prefix + raw + 'declared-intent-via-pad.json']), findingInventorySha256=q.sha(b'[]'), perCheckCounts={n: {k: 0 for k in ['count', 'knownForeignFindingCount', 'unknownFindingCount', 'sameOwnerRuleFindingCount']} for n in r.declared.CHECKS})
        audit = record['official']['routingMetrics']['experimentAudit']; audit.update(rawNewTracesHash=hashes['raw-new-traces.json'], rawOutputHash=q.sha(files[prefix + raw + 'raw-solver-output.json']))
        record['supplemental']['canonicalCircuitJsonSha256'] = hashes['canonical-circuit-json.json']
        record['supplemental']['validationTimeMs'] = 0
        full = {**copy.deepcopy(record['supplemental']), **audit, 'supplementalValidationTimeMs': 0}
        for name in r.CHECKS: full[name]['errors'] = []
        put(raw + 'capture-provenance.json', audit); put(raw + 'supplemental-validation.json', full)
        cp = record['phaseCheckpointAudit']; cp['scope'] = 'Synchronous stage boundaries, not pure-stage runtime attribution'; expected = r.expected_cp(m, case, arm, t.RUN, t.HEAD)
        checkpoint_rows = [{**expected, **x} for x in cp['stageBoundaries']]
        checkpoint_rows[-1].update(cp['lastDurableCheckpoint'])
        files[prefix + raw + 'phase-checkpoints.jsonl'] = b'\n'.join(encoded(x) for x in checkpoint_rows) + b'\n'
        cp['status']['rowsWritten'] = len(checkpoint_rows); put(raw + 'phase-checkpoint-status.json', cp['status'])
        config = dict(a['baseline'], evidencePaths=r.PATHS) if arm == 'A' else dict(m['candidate']); config['phaseCheckpoint'] = expected; put(f'config-{arm}.json', config)
        r.qualify(record, m, a, case, arm, t.RUN, t.HEAD)
        put(target + 'audit-result.json', record); put(target + 'benchmark-result.json', {'tests': [record['official']], 'runtime': record['officialReportRuntime']}); rows.append(record)
    summary = r.summarize(rows, case)
    files[prefix + 'results.jsonl'] = b'\n'.join(encoded(x) for x in rows) + b'\n'; put('summary.json', summary)
    harnesses = {arm: {'checkoutSha': r.MAIN if arm == 'A' else r.CANDIDATE, 'validators': a['expectedValidatorHashes'], **a['expectedHarnessSourceHashes'], 'dependencyResolution': {'directDependencies': {}}} for arm in 'AB'}
    put('provenance.json', {'manifest': m, 'manifestSha256': r.sha(r.MANIFEST), 'case': case, 'inputIdentity': {'sampleNumber': case['sample'], 'inputHash': case['inputHash']}, 'githubRunId': t.RUN, 'controllerSha': t.HEAD, 'runAttempt': '1', 'harnesses': harnesses, 'dependencyComparison': r.common.pinned.compare_dependency_resolutions(harnesses)})
    parsed = {'case': case, 'records': rows, 'summary': summary, 'runId': t.RUN, 'controllerSha': t.HEAD}
    def audit(changed=None, alternate=None):
        source = dict(files); source.update(changed or {}); payload = io.BytesIO()
        with zipfile.ZipFile(payload, 'w', compression=zipfile.ZIP_DEFLATED) as z:
            for name, data in source.items(): z.writestr(name, data)
        with zipfile.ZipFile(io.BytesIO(payload.getvalue())) as z: return q.qualify_zip(z, alternate or parsed, m, a)
    result = audit(); assert result['wholeOutputQualityCredit'] is True and result['noProposalOutputAndReportParity'] is True and result['allSevenReportsCompared'] is True
    checks = ['complete-two-record-original-ZIP-content-binding']
    unknown=copy.deepcopy(parsed);candidate=next(x for x in unknown['records'] if x['arm']=='B')
    evidence=json.loads((ROOT/'tests/fixtures/witness-quality6-source-unknown.json').read_text())['evidence']
    candidate['official']['routingMetrics']['experimentAudit']['evidence']=copy.deepcopy(evidence)
    candidate['phaseCheckpointAudit']['lastDurableCheckpoint']['evidence']=copy.deepcopy(evidence)
    r.qualify(candidate,m,a,case,'B',t.RUN,t.HEAD)
    assert candidate['strictIntegrityQualified'] and candidate['featureCoverage']['qualification']['lastReferenceErrors']==-1
    unknown['summary']=r.summarize(unknown['records'],case)
    changes={prefix+'results.jsonl':b'\n'.join(encoded(x) for x in unknown['records'])+b'\n',prefix+'summary.json':encoded(unknown['summary'])}
    target='pair-1/B/';new_audit=candidate['official']['routingMetrics']['experimentAudit']
    changes[prefix+target+'audit-result.json']=encoded(candidate)
    changes[prefix+target+'benchmark-result.json']=encoded({'tests':[candidate['official']],'runtime':candidate['officialReportRuntime']})
    changes[prefix+target+'raw/capture-provenance.json']=encoded(new_audit)
    full=json.loads(files[prefix+target+'raw/supplemental-validation.json']);full.update(new_audit);changes[prefix+target+'raw/supplemental-validation.json']=encoded(full)
    checkpoints=[json.loads(x) for x in files[prefix+target+'raw/phase-checkpoints.jsonl'].splitlines()];checkpoints[-1]['evidence']=copy.deepcopy(evidence)
    changes[prefix+target+'raw/phase-checkpoints.jsonl']=b'\n'.join(encoded(x) for x in checkpoints)+b'\n'
    unknown_result=audit(changes,unknown)
    assert unknown_result['noProposalOutputAndReportParity'] is True and unknown_result['wholeOutputQualityCredit'] is False
    checks.append('actual-source-UNKNOWN-minus1-with-independent-sevenPASS-is-NOT-full-certificate')
    def reject(label, fn):
        try: fn()
        except (ValueError, KeyError, TypeError): checks.append(label); return
        raise AssertionError('Accepted forged raw binding: ' + label)
    for name in ['pair-1/B/raw/original-input.json', 'pair-1/B/raw/raw-new-traces.json', 'pair-1/B/raw/declared-intent-via-pad.json', 'pair-1/B/raw/supplemental-validation.json', 'pair-1/B/raw/capture-provenance.json', 'config-B.json', 'provenance.json']:
        reject('tampered-' + name, lambda name=name: audit({prefix + name: b'{}'}))
    reject('unsafe-member', lambda: audit({'../escaped.json': b'{}'}))
    changed = copy.deepcopy(parsed); changed['records'][1]['official']['didTimeout'] = True
    reject('log-ZIP-outcome-mismatch', lambda: audit(alternate=changed))
    print(json.dumps({'status': 'PASS_SYNTHETIC_ZIP_ALL_RECORD_BYTE_BINDING_AND_TAMPER_REJECTION', 'checks': checks, 'count': len(checks), 'realBoards': 0, 'checkerExecutions': 0, 'networkRequests': 0}))


if __name__ == '__main__': main()
