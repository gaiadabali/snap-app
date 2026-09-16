"""Which handset produced a reading, and what that handset can decide.

`docs/ON-DEVICE.md` §1.2 pins the floor at a **4 GB** device — a Galaxy A16 5G
on Android, a 4 GB iPhone 11/12 on iOS — and §6.4 step 2 says the gate is run
there. The reason is stated in the doc: a phone with more memory "produces
numbers that pass and mean nothing."

This file exists for the same reason `provenance.py` does. `preview_score.py`
already REFUSED an unlabelled device, which stops the worst case — a number
with no provenance at all. But a *label* is not a control either. Passing
`--device galaxy-a71-8gb` satisfied that check completely, and the report then
printed timings beside §6.1's ceilings as though the comparison meant
something. The label was recorded and never consulted.

So the device is classified here, and the classification decides what the run
is allowed to conclude:

  floor         The device §1.2 names. Timing and memory numbers are THE gate.
  above-floor   More memory than the floor. FUNCTION is real — whether ML Kit
                resolves, whether boxes land on the right glyphs, whether the
                structurer reads genuine thermal print. FIT is not: a latency
                or peak-memory number here cannot pass §6.1, because the phone
                the budget was written for is smaller.
  below-floor   Less memory than the floor. A pass is STRONGER than the gate
                and may be reported as such; a failure is not disqualifying,
                because nothing promised this device.
  unknown       Not registered. Refused — same rule as an unlabelled device.

RAM IS THE MEASURED FIGURE, NOT THE SPEC SHEET. `SnapOcrModule.deviceInfo()`
returns `totalMemoryMb` from `ActivityManager.MemoryInfo.totalMem`, which is
what the OS will actually let an app see, and is always somewhat under the
number on the box (a "8 GB" A71 reports ~7.3 GiB). Every entry below records
where its figure came from, because a registry of guesses would recreate the
problem this file is here to stop.
"""
from __future__ import annotations

# docs/ON-DEVICE.md §1.2. Stated in MiB of TOTAL memory as the OS reports it.
FLOOR_RAM_MB = 4096

# The tolerance is for the gap between a nominal "4 GB" and what `totalMem`
# reports on such a phone, which is a few hundred MiB lower after the kernel
# and reserved regions are taken out. Without it a genuine 4 GB floor device
# would classify as below-floor and quietly make its own gate look generous.
FLOOR_TOLERANCE_MB = 512

ROLE_FLOOR = 'floor'
ROLE_ABOVE = 'above-floor'
ROLE_BELOW = 'below-floor'

DEVICES: dict[str, dict] = {
    'galaxy-a16-5g-4gb': {
        'label': 'Samsung Galaxy A16 5G (4 GB)',
        'platform': 'android',
        'ram_mb': 4096,
        'ram_source': 'spec — NOT YET MEASURED, no such handset has been run',
        'note': 'The Android floor. docs/ON-DEVICE.md §1.2.',
    },
    'iphone-11-4gb': {
        'label': 'Apple iPhone 11 (4 GB)',
        'platform': 'ios',
        'ram_mb': 4096,
        'ram_source': 'spec — NOT YET MEASURED',
        'note': 'The iOS floor; oldest model iOS 26 supports.',
    },
    'galaxy-a71-8gb': {
        'label': "Samsung Galaxy A71 (SM-A715F, 8 GB)",
        'platform': 'android',
        # 7700244 kB from /proc/meminfo over adb on 2026-09-16.
        'ram_mb': 7519,
        'ram_source': 'MEASURED — adb shell cat /proc/meminfo, 2026-09-16',
        'os': 'Android 13 (SDK 33), arm64-v8a, Play services 26.33.32',
        'note': (
            'The handset actually on the desk, and the chosen bench device. '
            'It is ~1.8x the floor, so it settles FUNCTION and not FIT.'
        ),
    },
    'galaxy-a6-3gb': {
        'label': 'Samsung Galaxy A6 (2018, 3 GB)',
        'platform': 'android',
        'ram_mb': 3072,
        'ram_source': 'spec — NOT YET MEASURED',
        'note': (
            'Below the floor, which makes it the useful adversarial device: '
            'if the preview holds here the A16 is safe.'
        ),
    },
}


class UnknownDevice(KeyError):
    """Raised for a device id that is not registered."""


def get(device: str) -> dict:
    """Registry entry for `device`, or raise naming what to do about it."""
    try:
        return DEVICES[device]
    except KeyError:
        raise UnknownDevice(
            f'unregistered device {device!r}. Known: {", ".join(sorted(DEVICES))}. '
            'Add it to bench/devices.py WITH ITS MEASURED totalMemoryMb before '
            'scoring against it — an unclassified device cannot be read, for the '
            'same reason docs/ON-DEVICE.md §1.2 gives about an unnamed one.'
        ) from None


def role_of(device: str) -> str:
    """Classify a registered device against the §1.2 floor."""
    ram = get(device)['ram_mb']
    if ram >= FLOOR_RAM_MB + FLOOR_TOLERANCE_MB:
        return ROLE_ABOVE
    if ram < FLOOR_RAM_MB - FLOOR_TOLERANCE_MB:
        return ROLE_BELOW
    return ROLE_FLOOR


def may_decide_fit(device: str) -> tuple[bool, str]:
    """May timing / peak-memory numbers from this device settle §6.1?

    Mirrors `provenance.may_publish_headline`: the refusal carries its reason,
    so a caller cannot act on the boolean without the sentence next to it.
    """
    role = role_of(device)
    entry = get(device)
    if role == ROLE_ABOVE:
        return False, (
            f'{entry["label"]} reports {entry["ram_mb"]} MB, '
            f'{entry["ram_mb"] - FLOOR_RAM_MB} MB ABOVE the {FLOOR_RAM_MB} MB floor. '
            'docs/ON-DEVICE.md §1.2: a phone with more memory produces numbers that '
            'pass and mean nothing. Function measured here is real; a latency or '
            'peak-memory figure is NOT the §6.1 gate.'
        )
    if role == ROLE_BELOW:
        return True, (
            f'{entry["label"]} reports {entry["ram_mb"]} MB, BELOW the '
            f'{FLOOR_RAM_MB} MB floor. A pass here is stronger than the gate. '
            'A failure is not disqualifying — nothing was promised for this device.'
        )
    return True, f'{entry["label"]} is the §1.2 floor device. These numbers are the gate.'


def banner(device: str | None) -> str:
    """One block naming the device and what it is allowed to conclude."""
    if device is None:
        return (
            'DEVICE: none — server sidecar only.\n'
            '  This measures the STRUCTURER, not a phone. docs/ON-DEVICE.md §6.4\n'
            '  step 2 needs DocDOMs exported from a handset before OD-6 can close.'
        )
    entry = get(device)
    ok, why = may_decide_fit(device)
    lines = [
        f'DEVICE: {entry["label"]}  [{role_of(device)}]',
        f'  RAM:  {entry["ram_mb"]} MB  ({entry["ram_source"]})',
    ]
    if entry.get('os'):
        lines.append(f'  OS:   {entry["os"]}')
    lines.append(f'  FIT (timing / memory vs §6.1): {"DECIDES" if ok else "CANNOT DECIDE"}')
    lines.append(f'    {why}')
    lines.append('  FUNCTION (does it read the document correctly): measured, and real.')
    return '\n'.join(lines)


if __name__ == '__main__':
    assert role_of('galaxy-a16-5g-4gb') == ROLE_FLOOR
    assert role_of('iphone-11-4gb') == ROLE_FLOOR
    assert role_of('galaxy-a71-8gb') == ROLE_ABOVE
    assert role_of('galaxy-a6-3gb') == ROLE_BELOW

    # The bench device must not be able to close the fit gate.
    ok, why = may_decide_fit('galaxy-a71-8gb')
    assert ok is False and 'mean nothing' in why, why

    # Below the floor is a HARDER test, so it is allowed to decide.
    ok, _ = may_decide_fit('galaxy-a6-3gb')
    assert ok is True

    try:
        role_of('pixel-9-pro')
    except UnknownDevice as exc:
        assert 'unregistered device' in str(exc)
    else:  # pragma: no cover
        raise AssertionError('an unregistered device must be refused, not assumed')

    print(banner('galaxy-a71-8gb'))
    print()
    print(banner(None))
    print('\ndevices.py self-check OK')
