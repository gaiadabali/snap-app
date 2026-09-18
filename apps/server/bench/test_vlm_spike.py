"""Tests for the OD-15 spike harness (vlm_spike.py).

No handset is attached (`adb devices` is empty for this whole ticket), so
these tests exercise validation and reporting against synthetic payloads
only -- never a claim about real model behaviour. That distinction matters
enough here to say explicitly: a green test below proves the HARNESS is
correct, not that any number in it is a real measurement. The only real
measurements come from `python vlm_spike_server.py --device ... --model ...`
run against an actual phone.

Run from apps/server/bench/:
    python -m unittest test_vlm_spike -v
"""
from __future__ import annotations

import json
import os
import shutil
import tempfile
import unittest

import devices as dev
import vlm_spike as spike


def good_payload(model: str, **overrides) -> dict:
    base = {
        'model': model,
        'runtime': spike.MODELS[model]['runtime_options'][0],
        'runtimeVersion': '0.0.0-test',
        'device': {'platform': 'android', 'totalMemoryMb': 7519, 'osVersion': '13'},
        'weights': {'source': 'downloaded', 'bytes': 2_600_000_000},
        'timings': {'modelLoadMs': 4200.0, 'timeToFirstFieldMs': 18000.0},
        'peakMemoryMb': 1800.0,
        'output': {'raw': 'TOTAL 48.50', 'truncated': False},
        'documentId': 'receipt-easy',
    }
    base.update(overrides)
    return base


class TestValidation(unittest.TestCase):
    def test_a_complete_payload_validates(self):
        spike.validate_result('galaxy-a71-8gb', good_payload('gemma-4-e2b'))  # no raise

    def test_unknown_model_is_refused(self):
        payload = good_payload('gemma-4-e2b')
        payload['model'] = 'gpt-5'
        with self.assertRaises(spike.SpikeValidationError) as ctx:
            spike.validate_result('galaxy-a71-8gb', payload)
        self.assertIn('unknown model', str(ctx.exception))

    def test_wrong_runtime_for_model_is_refused(self):
        with self.assertRaises(spike.SpikeValidationError) as ctx:
            spike.validate_result(
                'galaxy-a71-8gb',
                good_payload('gemma-4-e2b', runtime='react-native-executorch'),
            )
        self.assertIn('runtime', str(ctx.exception))

    def test_platform_mismatch_is_refused(self):
        payload = good_payload('gemma-4-e2b')
        payload['device']['platform'] = 'ios'
        with self.assertRaises(spike.SpikeValidationError) as ctx:
            spike.validate_result('galaxy-a71-8gb', payload)
        self.assertIn('android', str(ctx.exception))

    def test_ram_mismatch_is_refused_same_control_as_device_server(self):
        payload = good_payload('gemma-4-e2b')
        payload['device']['totalMemoryMb'] = 4096  # claims a floor phone's RAM
        with self.assertRaises(spike.SpikeValidationError) as ctx:
            spike.validate_result('galaxy-a71-8gb', payload)
        self.assertIn('registered at', str(ctx.exception))

    def test_missing_time_to_first_field_is_refused(self):
        payload = good_payload('gemma-4-e2b')
        del payload['timings']['timeToFirstFieldMs']
        with self.assertRaises(spike.SpikeValidationError) as ctx:
            spike.validate_result('galaxy-a71-8gb', payload)
        self.assertIn('timings missing', str(ctx.exception))

    def test_missing_peak_memory_is_refused(self):
        payload = good_payload('florence-2-base')
        payload['peakMemoryMb'] = None
        with self.assertRaises(spike.SpikeValidationError) as ctx:
            spike.validate_result('galaxy-a71-8gb', payload)
        self.assertIn('peakMemoryMb', str(ctx.exception))

    def test_missing_download_bytes_is_refused(self):
        payload = good_payload('florence-2-base')
        del payload['weights']['bytes']
        with self.assertRaises(spike.SpikeValidationError) as ctx:
            spike.validate_result('galaxy-a71-8gb', payload)
        self.assertIn('weights.bytes', str(ctx.exception))

    def test_empty_output_is_refused_not_recorded_as_a_pass(self):
        payload = good_payload('florence-2-base')
        payload['output']['raw'] = ''
        with self.assertRaises(spike.SpikeValidationError) as ctx:
            spike.validate_result('galaxy-a71-8gb', payload)
        self.assertIn('FUNCTION', str(ctx.exception))

    def test_unregistered_device_is_refused_not_assumed(self):
        with self.assertRaises(dev.UnknownDevice):
            spike.validate_result('pixel-9-pro', good_payload('gemma-4-e2b'))


class TestRecordAndSummarise(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self._orig_root = spike.RESULTS_ROOT
        spike.RESULTS_ROOT = self.tmp

    def tearDown(self):
        spike.RESULTS_ROOT = self._orig_root
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_record_writes_a_file_stamped_with_the_fit_verdict(self):
        path = spike.record_result('galaxy-a71-8gb', good_payload('gemma-4-e2b'))
        self.assertTrue(os.path.exists(path))
        with open(path, encoding='utf-8') as f:
            data = json.load(f)
        self.assertEqual(data['device_role'], dev.ROLE_ABOVE)
        self.assertFalse(data['may_decide_fit'])
        self.assertIn('mean nothing', data['fit_reason'])
        self.assertEqual(len(data['runs']), 1)

    def test_a_below_floor_device_result_may_decide_fit(self):
        payload = good_payload('florence-2-base')
        payload['device'] = {'platform': 'android', 'totalMemoryMb': 3072, 'osVersion': '9'}
        path = spike.record_result('galaxy-a6-3gb', payload)
        with open(path, encoding='utf-8') as f:
            data = json.load(f)
        self.assertTrue(data['may_decide_fit'])

    def test_repeated_runs_append_rather_than_overwrite(self):
        spike.record_result('galaxy-a71-8gb', good_payload('gemma-4-e2b'))
        spike.record_result('galaxy-a71-8gb', good_payload('gemma-4-e2b', timings={
            'modelLoadMs': 4300.0, 'timeToFirstFieldMs': 19000.0,
        }))
        summary = spike.summarise('gemma-4-e2b', 'galaxy-a71-8gb')
        self.assertEqual(summary['n_runs'], 2)

    def test_summarise_of_no_runs_is_none_not_zero(self):
        self.assertIsNone(spike.summarise('gemma-4-e2b', 'galaxy-a71-8gb'))

    def test_first_run_download_reports_the_paid_download_not_a_mean_with_cached_reruns(self):
        spike.record_result('galaxy-a71-8gb', good_payload(
            'gemma-4-e2b', weights={'source': 'downloaded', 'bytes': 2_600_000_000}))
        spike.record_result('galaxy-a71-8gb', good_payload(
            'gemma-4-e2b', weights={'source': 'cached', 'bytes': 0}))
        summary = spike.summarise('gemma-4-e2b', 'galaxy-a71-8gb')
        self.assertEqual(summary['first_run_download_bytes'], 2_600_000_000)

    def test_od_2_2_row_carries_the_fit_caveat_for_the_above_floor_bench_device(self):
        spike.record_result('galaxy-a71-8gb', good_payload('gemma-4-e2b'))
        row = spike.render_od2_2_row('gemma-4-e2b', 'galaxy-a71-8gb')
        self.assertIn('does not settle §6.1', row)
        self.assertIn('[measured]', row)

    def test_od_2_2_row_has_no_caveat_for_a_true_floor_device(self):
        payload = good_payload('florence-2-base')
        payload['device'] = {'platform': 'android', 'totalMemoryMb': 4096, 'osVersion': '14'}
        spike.record_result('galaxy-a16-5g-4gb', payload)
        row = spike.render_od2_2_row('florence-2-base', 'galaxy-a16-5g-4gb')
        self.assertNotIn('does not settle', row)
        self.assertIn('[measured]', row)

    def test_row_is_none_with_no_recorded_runs(self):
        self.assertIsNone(spike.render_od2_2_row('gemma-4-e2b', 'galaxy-a71-8gb'))


class TestLicenceFloor(unittest.TestCase):
    def test_both_models_and_both_runtimes_pass_d23(self):
        for model, spec in spike.MODELS.items():
            with self.subTest(model=model):
                self.assertTrue(spec['passes_d23'], f'{model} must record a D23 verdict')
                self.assertIn(spec['licence'], ('Apache-2.0', 'MIT'))
        for runtime, info in spike.RUNTIME_LICENCES.items():
            with self.subTest(runtime=runtime):
                self.assertTrue(info['passes_d23'])
                self.assertIn(info['licence'], ('Apache-2.0', 'MIT'))


if __name__ == '__main__':
    unittest.main(verbosity=2)
