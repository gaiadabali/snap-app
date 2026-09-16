"""Tests for the device classification control (docs/ON-DEVICE.md §1.2).

Stdlib `unittest` only, like `test_provenance.py`, and for the same reason:
most of what is asserted here is a REFUSAL. `preview_score.py` already
demanded a `--device` label, and that check passed happily when handed
`galaxy-a71-8gb` — a phone with 1.8x the floor's memory — after which the
report printed timings next to §6.1's ceilings as though they were comparable.
The label was recorded and never consulted, which is the same shape as the
`"synthetic": true` flag that `provenance.py`'s header describes.

Run from apps/server/bench/:
    python -m unittest test_devices -v
"""
from __future__ import annotations

import unittest

import devices as dev


class TestClassification(unittest.TestCase):
    def test_the_floor_devices_classify_as_the_floor(self):
        self.assertEqual(dev.role_of('galaxy-a16-5g-4gb'), dev.ROLE_FLOOR)
        self.assertEqual(dev.role_of('iphone-11-4gb'), dev.ROLE_FLOOR)

    def test_the_bench_handset_is_above_the_floor(self):
        # The one on the desk. If this ever reports `floor`, the tolerance has
        # been widened until it swallows a phone with 3.4GB of headroom.
        self.assertEqual(dev.role_of('galaxy-a71-8gb'), dev.ROLE_ABOVE)

    def test_the_a6_is_below_the_floor(self):
        self.assertEqual(dev.role_of('galaxy-a6-3gb'), dev.ROLE_BELOW)

    def test_tolerance_absorbs_the_gap_between_nominal_and_reported_ram(self):
        # A nominal 4GB phone reports a few hundred MB less through
        # ActivityManager. Without the tolerance the real floor device would
        # classify as below-floor and flatter its own gate.
        self.assertLess(dev.FLOOR_TOLERANCE_MB, dev.FLOOR_RAM_MB / 4)
        self.assertGreater(dev.FLOOR_TOLERANCE_MB, 0)


class TestRefusals(unittest.TestCase):
    def test_an_above_floor_device_CANNOT_decide_fit(self):
        ok, why = dev.may_decide_fit('galaxy-a71-8gb')
        self.assertFalse(ok)
        # The refusal must carry its reason, so a caller cannot act on the
        # boolean without the sentence beside it.
        self.assertIn('mean nothing', why)
        self.assertIn('ABOVE', why)

    def test_a_below_floor_device_MAY_decide_fit_and_says_why(self):
        ok, why = dev.may_decide_fit('galaxy-a6-3gb')
        self.assertTrue(ok)
        self.assertIn('stronger than the gate', why)
        self.assertIn('not disqualifying', why)

    def test_the_floor_device_decides_the_gate(self):
        ok, why = dev.may_decide_fit('galaxy-a16-5g-4gb')
        self.assertTrue(ok)
        self.assertIn('are the gate', why)

    def test_an_unregistered_device_is_refused_not_assumed(self):
        with self.assertRaises(dev.UnknownDevice) as ctx:
            dev.role_of('pixel-9-pro')
        message = str(ctx.exception)
        self.assertIn('unregistered device', message)
        # It must name the registered ones, or the refusal is a dead end.
        self.assertIn('galaxy-a71-8gb', message)
        self.assertIn('MEASURED', message)

    def test_every_registered_device_carries_where_its_ram_came_from(self):
        # A registry of guesses would recreate the problem this file stops.
        for name, entry in dev.DEVICES.items():
            with self.subTest(device=name):
                self.assertTrue(entry.get('ram_source'), f'{name} has no ram_source')
                self.assertIsInstance(entry['ram_mb'], int)
                self.assertGreater(entry['ram_mb'], 0)

    def test_the_bench_handset_ram_is_measured_rather_than_assumed(self):
        entry = dev.DEVICES['galaxy-a71-8gb']
        self.assertIn('MEASURED', entry['ram_source'])


class TestBanner(unittest.TestCase):
    def test_banner_states_the_fit_verdict_for_the_bench_handset(self):
        text = dev.banner('galaxy-a71-8gb')
        self.assertIn('CANNOT DECIDE', text)
        self.assertIn('above-floor', text)
        # Function is still real, and the banner must say so — otherwise the
        # honest limit reads as "this run was worthless", which it is not.
        self.assertIn('FUNCTION', text)

    def test_banner_with_no_device_names_the_server_sidecar(self):
        text = dev.banner(None)
        self.assertIn('server sidecar', text)
        self.assertIn('§6.4', text)


if __name__ == '__main__':
    unittest.main(verbosity=2)
