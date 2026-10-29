"""One synthetic terminal-dispatch accounting test; every named work row stays."""
import copy
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
s = importlib.util.spec_from_file_location('repeat_terminal_mask', ROOT / 'witness-quality6-raw-proof.py')
q = importlib.util.module_from_spec(s); s.loader.exec_module(q)


def main():
    native = {'event': 'phase_run_enter', 'phaseName': 'powerTraceExpansionSolver', 'activeSolverName': 'PowerTraceExpansionSolver', 'activeIterations': 0, 'activeMaxIterations': 1}
    terminal = {'event': 'phase_setup_enter', 'phaseName': None, 'activeSolverName': None, 'activeIterations': None, 'activeMaxIterations': None}
    end = {**terminal, 'event': 'solve_exit', 'solved': True, 'failed': False, 'error': None}
    rows = {'A': [copy.deepcopy(native), copy.deepcopy(terminal), copy.deepcopy(end)], 'B': [copy.deepcopy(native), {**native, 'event': 'phase_setup_enter', 'phaseName': q.r.STAGE}, copy.deepcopy(terminal), copy.deepcopy(end)]}
    result = q.common_work_pair(rows)
    assert result['applied'] and result['commonNativePhaseWorkEqual'] and result['droppedRows'] == {'A': 1, 'B': 0}
    checks = ['baseline-only-terminal-accounted-after-both-explicit-successful-terminal-events']
    def reject(name, mutation):
        value = copy.deepcopy(rows); mutation(value)
        try: result = q.common_work_pair(value)
        except (ValueError, KeyError, TypeError, IndexError): checks.append(name); return
        assert result['commonNativePhaseWorkEqual'] is False, name
        checks.append(name)
    reject('named-native-iteration-change', lambda x: x['A'][0].update(activeIterations=1))
    reject('named-native-budget-change', lambda x: x['B'][0].update(activeMaxIterations=2))
    reject('named-native-event-change', lambda x: x['A'][0].update(event='on_solved_enter'))
    reject('named-native-event-added', lambda x: x['B'].insert(0, copy.deepcopy(native)))
    reject('terminal-active-iteration-not-null', lambda x: x['A'][-2].update(activeIterations=0))
    reject('terminal-missing-explicit-key', lambda x: x['B'][-2].pop('activeMaxIterations'))
    reject('duplicate-empty-setup', lambda x: x['A'].insert(0, copy.deepcopy(terminal)))
    reject('empty-setup-not-penultimate', lambda x: x['A'].insert(-1, copy.deepcopy(native)))
    reject('candidate-terminal-different', lambda x: x['B'][-2].update(activeSolverName='unexpected'))
    reject('candidate-final-not-solved', lambda x: x['B'][-1].update(solved=False))
    reject('baseline-final-failed', lambda x: x['A'][-1].update(failed=True))
    reject('baseline-final-error', lambda x: x['A'][-1].update(error='native error'))
    identical = q.common_work_pair({'A': [native], 'B': [native]})
    assert identical['commonNativePhaseWorkEqual'] and identical['applied'] is False
    checks.append('already-identical-native-projection-is-unchanged')
    print(json.dumps({'status': 'PASS_EXACT_OPTIONAL_TERMINAL_NULL_PROJECTION', 'count': len(checks), 'checks': checks, 'actualBoards': 0}))


if __name__ == '__main__': main()
