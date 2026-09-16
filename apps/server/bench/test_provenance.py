"""Tests for the corpus provenance control (docs/CORPUS.md §4).

Stdlib `unittest` only — this environment has no pytest, and the rest of
`bench/` does not depend on one (see `ocr/test_ocr_metrics.py`'s header).

Run from apps/server/bench/:
    python -m unittest test_provenance -v

WHAT THESE TESTS ARE FOR. Every one of them asserts a REFUSAL. That is
deliberate and it is the lesson `docs/DEPLOY.md` §8 records: a suite that only
proves the happy path is what let the RLS bypass survive, and three
`SNAP_ALLOW_PLACEHOLDER_PROOF` overrides meant the testimonial guard could
never fire in any automated path. A control that is never observed refusing is
not known to be a control.

So: the manifest is rejected without a tier, a tier-R document captured outside
Australia is rejected, an unreviewed real document is rejected, and the
headline number refuses to print below tier R. Each was verified by breaking
the guard and watching the matching test fail.
"""
from __future__ import annotations

import copy
import json
import os
import unittest

import provenance as prov


HERE = os.path.dirname(os.path.abspath(__file__))


def _doc(tier='S', **overrides):
    """A minimal valid document for the given tier."""
    base = {
        'id': 'fixture',
        'provenance': {
            'tier': tier,
            'source': 'a source',
            'licence': 'ours',
            'captured_in': None if tier == prov.TIER_SYNTHETIC else 'AU',
            'pii_reviewed': True,
        },
    }
    base['provenance'].update(overrides)
    return base


class TheManifestMustDeclareATier(unittest.TestCase):
    def test_a_document_with_no_provenance_block_is_refused(self):
        with self.assertRaises(prov.ProvenanceError) as cm:
            prov.assert_manifest_provenance_valid({'documents': [{'id': 'nude'}]})
        self.assertIn('no provenance block', str(cm.exception))

    def test_a_missing_tier_is_refused_rather_than_defaulted(self):
        d = _doc()
        del d['provenance']['tier']
        with self.assertRaises(prov.ProvenanceError) as cm:
            prov.assert_manifest_provenance_valid({'documents': [d]})
        # The point of the whole file: no default. A defaulted tier is a guess
        # about whether the run can back a claim.
        self.assertIn('tier', str(cm.exception))

    def test_an_unknown_tier_is_refused(self):
        with self.assertRaises(prov.ProvenanceError):
            prov.assert_manifest_provenance_valid({'documents': [_doc(tier='X')]})

    def test_every_offending_document_is_named_in_one_go(self):
        a, b = _doc(), _doc()
        a['id'], b['id'] = 'first', 'second'
        del a['provenance']['tier']
        b['provenance']['licence'] = ''
        with self.assertRaises(prov.ProvenanceError) as cm:
            prov.assert_manifest_provenance_valid({'documents': [a, b]})
        msg = str(cm.exception)
        # One run fixes the whole manifest, same as abn.py.
        self.assertIn('first', msg)
        self.assertIn('second', msg)


class TheTierMustBeCoherentWithTheDocument(unittest.TestCase):
    def test_synthetic_may_not_claim_a_capture_country(self):
        with self.assertRaises(prov.ProvenanceError) as cm:
            prov.assert_manifest_provenance_valid({'documents': [_doc(captured_in='AU')]})
        self.assertIn('must be null', str(cm.exception))

    def test_a_real_capture_must_say_where(self):
        with self.assertRaises(prov.ProvenanceError):
            prov.assert_manifest_provenance_valid(
                {'documents': [_doc(tier=prov.TIER_PUBLIC, captured_in=None)]}
            )

    def test_tier_R_captured_outside_australia_is_refused(self):
        # The one that actually matters commercially: tier R IS the claim about
        # Australian paperwork. A Singaporean docket is tier P however real.
        with self.assertRaises(prov.ProvenanceError) as cm:
            prov.assert_manifest_provenance_valid(
                {'documents': [_doc(tier=prov.TIER_REAL_AU, captured_in='SG')]}
            )
        self.assertIn('tier P', str(cm.exception))

    def test_a_real_document_must_have_been_pii_reviewed(self):
        for tier in (prov.TIER_PUBLIC, prov.TIER_REAL_AU):
            with self.subTest(tier=tier):
                with self.assertRaises(prov.ProvenanceError) as cm:
                    prov.assert_manifest_provenance_valid(
                        {'documents': [_doc(tier=tier, pii_reviewed=False)]}
                    )
                self.assertIn('pii_reviewed', str(cm.exception))

    def test_a_valid_manifest_of_each_tier_passes(self):
        for tier in prov.TIERS:
            with self.subTest(tier=tier):
                prov.assert_manifest_provenance_valid({'documents': [_doc(tier=tier)]})


class TheWeakestTierIsTheFloor(unittest.TestCase):
    def test_a_mixed_run_reports_its_weakest_document(self):
        docs = [_doc(tier=prov.TIER_REAL_AU), _doc(tier=prov.TIER_SYNTHETIC)]
        self.assertEqual(prov.weakest_tier(docs), prov.TIER_SYNTHETIC)

    def test_an_all_real_run_reports_R(self):
        self.assertEqual(
            prov.weakest_tier([_doc(tier=prov.TIER_REAL_AU)] * 3), prov.TIER_REAL_AU
        )

    def test_an_empty_run_has_no_tier(self):
        self.assertIsNone(prov.weakest_tier([]))

    def test_the_breakdown_is_always_available(self):
        docs = [_doc(tier='S'), _doc(tier='S'), _doc(tier='P')]
        self.assertEqual(prov.tier_breakdown(docs), {'S': 2, 'P': 1, 'R': 0})


class TheHeadlineRefusesBelowTierR(unittest.TestCase):
    def test_synthetic_refuses_and_says_why(self):
        allowed, reason = prov.may_publish_headline(prov.TIER_SYNTHETIC)
        self.assertFalse(allowed)
        self.assertIn('REFUSED', reason)
        # The reason has to carry the mechanism, not just the verdict —
        # otherwise the next person reads it as bureaucracy and overrides it.
        self.assertIn('calibration', reason)

    def test_public_refuses_because_it_is_not_australian(self):
        allowed, reason = prov.may_publish_headline(prov.TIER_PUBLIC)
        self.assertFalse(allowed)
        self.assertIn('not Australian', reason)

    def test_real_au_is_the_only_tier_allowed(self):
        allowed, reason = prov.may_publish_headline(prov.TIER_REAL_AU)
        self.assertTrue(allowed)
        self.assertEqual(reason, '')

    def test_no_documents_is_a_refusal_not_a_zero(self):
        allowed, _ = prov.may_publish_headline(None)
        self.assertFalse(allowed)

    def test_the_banner_marks_every_non_R_run_as_unquotable(self):
        for tier in (prov.TIER_SYNTHETIC, prov.TIER_PUBLIC):
            with self.subTest(tier=tier):
                self.assertIn('NOT evidence', prov.banner(tier))
        self.assertNotIn('NOT evidence', prov.banner(prov.TIER_REAL_AU))


class TheCommittedManifestIsValid(unittest.TestCase):
    """The real manifest, not a fixture — this is the regression guard."""

    def setUp(self):
        with open(os.path.join(HERE, 'manifest.json'), encoding='utf-8') as f:
            self.manifest = json.load(f)

    def test_it_passes_the_control(self):
        prov.assert_manifest_provenance_valid(self.manifest)

    def test_it_is_currently_all_synthetic_and_therefore_unquotable(self):
        docs = self.manifest['documents']
        floor = prov.weakest_tier(docs)
        self.assertEqual(floor, prov.TIER_SYNTHETIC)
        allowed, _ = prov.may_publish_headline(floor)
        self.assertFalse(
            allowed,
            'The committed corpus is synthetic. If this assertion ever fails because real '
            'Australian captures landed, that is good news — update this test to match the '
            'new floor, deliberately.',
        )

    def test_breaking_one_document_breaks_the_manifest(self):
        # Verifies the guard by removing it, which is the only way to know a
        # test asserting a refusal is actually wired to anything.
        broken = copy.deepcopy(self.manifest)
        del broken['documents'][0]['provenance']['tier']
        with self.assertRaises(prov.ProvenanceError):
            prov.assert_manifest_provenance_valid(broken)


if __name__ == '__main__':
    unittest.main()


class CorrectionsPer100CountsEveryCorrection(unittest.TestCase):
    """`docs/GAPS.md` B4, and the bug the dry run found.

    B4's formula names six outcomes. UNPARSEABLE is the seventh, and excluding
    it scored a TOTAL extraction failure as zero corrections — the best
    possible result — because no field ever landed in wrong/miss/hallucinated.
    Found by running `compare.py --dry-run`, where every field is UNPARSEABLE
    by construction and the headline came back 0.0.
    """

    def _report(self, *outcomes):
        import scoring
        return {
            'results': [{
                'engine': 'e',
                'field_outcomes_by_run': {f'f{i}': [o] for i, o in enumerate(outcomes)},
            }]
        }

    def test_a_document_that_did_not_parse_is_a_full_document_of_corrections(self):
        import compare
        import scoring
        r = self._report(*([scoring.UNPARSEABLE] * 8))
        self.assertEqual(compare.corrections_per_100(r)['e'], 800.0)

    def test_correct_abstention_costs_nobody_a_correction(self):
        import compare
        import scoring
        r = self._report(scoring.ABSTAIN_OK, scoring.EXACT, scoring.NORMALISED)
        self.assertEqual(compare.corrections_per_100(r)['e'], 0.0)

    def test_wrong_miss_and_hallucinated_each_count(self):
        import compare
        import scoring
        r = self._report(scoring.WRONG, scoring.MISS, scoring.HALLUCINATED, scoring.EXACT)
        self.assertEqual(compare.corrections_per_100(r)['e'], 300.0)
