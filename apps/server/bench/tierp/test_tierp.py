"""Tests for tier P intake — the licence gate, the PII filter, the truth mapping.

Run from apps/server/bench/:
    python -m unittest tierp.test_tierp -v

Like `test_provenance.py`, most of these assert a REFUSAL: an unlicensed source
is refused, a heavily-PII document is dropped, a total is never masked. A filter
that has never been observed rejecting anything is not known to be a filter.
"""
from __future__ import annotations

import unittest

from . import redact, sources


class TheLicenceGateRefuses(unittest.TestCase):
    def test_an_unstated_licence_is_refused(self):
        with self.assertRaises(sources.SourceRefused) as cm:
            sources.get('sroie')
        # The reason must carry the rule, not just the verdict — otherwise the
        # next person reads it as an oversight and "fixes" it by adding SROIE.
        self.assertIn('unstated', str(cm.exception).lower())

    def test_generated_images_are_refused_even_though_the_licence_is_fine(self):
        # MIT, and still useless here: generated invoices are tier S with extra
        # steps. Real print is the ONLY reason tier P exists.
        with self.assertRaises(sources.SourceRefused) as cm:
            sources.get('invoices-donut')
        self.assertIn('generated', str(cm.exception).lower())

    def test_an_unknown_source_is_refused_and_lists_what_is_known(self):
        with self.assertRaises(sources.SourceRefused) as cm:
            sources.get('not-a-dataset')
        self.assertIn('cord-v2', str(cm.exception))

    def test_a_licensed_photographed_source_passes(self):
        s = sources.get('cord-v2')
        self.assertEqual(s.licence, 'cc-by-4.0')
        self.assertEqual(s.captured_in, 'ID')

    def test_a_source_whose_licence_is_not_on_the_accept_list_is_refused(self):
        bad = sources.Source(
            key='x', dataset='d', config='c', split='s', licence='openrail',
            captured_in='SG', description='',
        )
        with self.assertRaises(sources.SourceRefused):
            bad.check()


class ThePiiFilterFindsWhatItShould(unittest.TestCase):
    def test_a_full_card_number_in_any_grouping(self):
        for t in ('4111111111111111', '4111 1111 1111 1111', '4111-1111-1111-1111'):
            with self.subTest(t=t):
                self.assertEqual(redact.looks_like_pii(t), 'card')

    def test_a_masked_pan_is_still_pii(self):
        self.assertIsNotNone(redact.looks_like_pii('VISA ****4417'))

    def test_emails_and_phones(self):
        self.assertEqual(redact.looks_like_pii('kate@marshtransport.example'), 'email')
        self.assertIsNotNone(redact.looks_like_pii('+61 412 345 678'))

    def test_a_loyalty_number(self):
        self.assertIsNotNone(redact.looks_like_pii('Member 88213394'))


class ThePiiFilterNeverEatsTheData(unittest.TestCase):
    """The failure that would matter most: masking the figure being measured."""

    def test_money_is_never_redacted_in_either_locale(self):
        for t in ('$266.91', '266.91', '17,519.31', '60.000', '1.042,60', '$ 44.78'):
            with self.subTest(t=t):
                self.assertIsNone(redact.looks_like_pii(t), f'{t!r} would have been masked')

    def test_dates_and_times_are_never_redacted(self):
        for t in ('06/09/2026', '31/05/26', '14:32', '2026-09-16'):
            with self.subTest(t=t):
                self.assertIsNone(redact.looks_like_pii(t))

    def test_an_abn_is_not_treated_as_a_card(self):
        # 11 digits, below the 13-digit card floor. An AU document's ABN is
        # ground truth we score against — masking it would be self-defeating.
        self.assertIsNone(redact.looks_like_pii('51824753556'))

    def test_ordinary_receipt_text_is_left_alone(self):
        for t in ('DIESEL 128.44L @ 1.899', 'TOTAL', 'GST INCLUDED', 'BANANAS 1.2KG'):
            with self.subTest(t=t):
                self.assertIsNone(redact.looks_like_pii(t))


class AHeavilyPiiDocumentIsDroppedNotCleaned(unittest.TestCase):
    def test_under_the_limit_is_imported(self):
        keep, reason = redact.decide([redact.Hit('card', 'x', {})] * redact.MAX_REDACTIONS)
        self.assertTrue(keep)

    def test_over_the_limit_is_dropped_with_a_reason(self):
        keep, reason = redact.decide([redact.Hit('card', 'x', {})] * (redact.MAX_REDACTIONS + 1))
        self.assertFalse(keep)
        self.assertIn('Dropped', reason)

    def test_a_clean_document_says_so(self):
        keep, reason = redact.decide([])
        self.assertTrue(keep)
        self.assertIn('no PII', reason)


class TheTruthMappingInventsNothing(unittest.TestCase):
    def setUp(self):
        from . import ingest
        self.ingest = ingest

    def test_a_receipt_with_no_total_is_unusable(self):
        self.assertIsNone(self.ingest.truth_from_cord({'gt_parse': {'menu': {}}}))

    def test_a_single_item_menu_is_a_dict_not_a_list(self):
        # CORD emits a bare dict for one-item receipts. Treating it as a list
        # iterates its KEYS and produces line items called "nm" and "price".
        t = self.ingest.truth_from_cord({'gt_parse': {
            'menu': {'nm': 'TICKET', 'price': '60.000'},
            'total': {'total_price': '60.000'},
        }})
        self.assertEqual(t['lines'], [{'description': 'TICKET', 'amount': '60.000'}])

    def test_supplier_and_date_are_omitted_rather_than_guessed(self):
        t = self.ingest.truth_from_cord({'gt_parse': {'total': {'total_price': '10.000'}}})
        self.assertNotIn('supplier_name', t)
        self.assertNotIn('issue_date', t)

    def test_money_is_carried_as_printed(self):
        t = self.ingest.truth_from_cord({'gt_parse': {'total': {'total_price': '60.000'}}})
        # NOT 60.0, and not 60000. The string as printed — see ingest.py's header.
        self.assertEqual(t['total_inclusive'], '60.000')


class TheManifestEntryIsWellFormed(unittest.TestCase):
    def setUp(self):
        from . import ingest
        self.source = sources.get('cord-v2')
        self.entry = ingest.manifest_entry(
            'tierp-cord-v2-0000', self.source, 'corpus/tierp/x.png',
            {'total_inclusive': '60.000', 'tax_printed': '5.455',
             'lines': [{'description': 'TICKET', 'amount': '60.000'}],
             'lines_are_complete': True},
            'no PII detected', 7,
        )

    def test_it_passes_the_provenance_control_as_tier_P(self):
        import provenance as prov
        prov.assert_manifest_provenance_valid({'documents': [self.entry]})
        self.assertEqual(prov.weakest_tier([self.entry]), prov.TIER_PUBLIC)

    def test_tier_P_cannot_publish_a_headline(self):
        import provenance as prov
        allowed, reason = prov.may_publish_headline(prov.weakest_tier([self.entry]))
        self.assertFalse(allowed)
        self.assertIn('not Australian', reason)

    def test_money_is_compared_on_digits(self):
        # The locale hazard, and the over-correction that followed it.
        # `amount` reads "60.000" as 60.0. `text` marked a model that returned
        # "16500" against a truth of "16,500" WRONG — every digit correct.
        # `digits` strips separators and is the only comparator that measures
        # what tier P is actually for.
        self.assertEqual(self.entry['fields']['total_inclusive']['compare'], 'digits')
        self.assertEqual(self.entry['fields']['gst_amount']['compare'], 'digits')

    def test_separator_style_does_not_change_the_verdict(self):
        import scoring
        for got in ('16,500', '16500', '16.500'):
            with self.subTest(got=got):
                self.assertIn(scoring.score_field('digits', '16,500', got),
                              (scoring.EXACT, scoring.NORMALISED))
        # ...but a genuinely dropped digit is still WRONG.
        self.assertEqual(scoring.score_field('digits', '11,000', '11.00'), scoring.WRONG)

    def test_abn_and_tax_invoice_are_abstention_cases(self):
        self.assertIsNone(self.entry['fields']['supplier_abn']['truth'])
        self.assertIs(self.entry['fields']['is_tax_invoice']['truth'], False)

    def test_it_passes_the_abn_control(self):
        import abn as abn_mod
        abn_mod.assert_manifest_abns_valid({'documents': [self.entry]})

    def test_a_perfect_reader_scores_clean_and_an_invented_abn_is_hallucinated(self):
        import scoring
        got = {n: s['truth'] for n, s in self.entry['fields'].items()}
        got['lines'] = self.entry['lines']['truth']
        self.assertTrue(scoring.score_document(self.entry, got).field_pass())

        got['supplier_abn'] = '51824753556'
        ds = scoring.score_document(self.entry, got)
        self.assertEqual(ds.outcomes['supplier_abn'], scoring.HALLUCINATED)


if __name__ == '__main__':
    unittest.main()


class PiiSplitAcrossSpansIsStillFound(unittest.TestCase):
    """The false negative that a span-only filter cannot see.

    The sidecar tokenises a line into word spans, so `MASTERCARD ****8830`
    arrives as three spans and no single one matches a masked-PAN pattern.
    Verified against the real tokenisation: the deployed engine returns
    '***' as its own span on these dockets.
    """

    def _doc(self, *texts):
        return {'blocks': [{'lines': [{'spans': [
            {'text': t, 'box': {'x': i * 40, 'y': 10, 'width': 38, 'height': 12}}
            for i, t in enumerate(texts)
        ]}]}]}

    def test_a_masked_pan_split_into_word_spans_is_caught(self):
        doc = self._doc('MASTERCARD', '****', '8830')
        self.assertEqual(redact.find(
            [s for b in doc['blocks'] for l in b['lines'] for s in l['spans']]
        ), [], 'span-level should miss it — that is the premise of this test')
        hits = redact.find_in_document(doc)
        self.assertEqual(len(hits), 1)
        self.assertEqual(hits[0].kind, 'card-masked')

    def test_a_full_pan_split_into_groups_is_caught(self):
        hits = redact.find_in_document(self._doc('4111', '1111', '1111', '1111'))
        self.assertEqual(len(hits), 1)

    def test_the_masked_box_covers_every_contributing_span(self):
        hits = redact.find_in_document(self._doc('MASTERCARD', '****', '8830'))
        box = hits[0].box
        self.assertEqual(box['x'], 0)
        self.assertEqual(box['x'] + box['width'], 118)  # 80 + 38, the last span's right edge

    def test_an_ordinary_line_is_not_flagged_by_joining_it(self):
        # Joining must not manufacture PII out of innocuous tokens.
        for line in (('DIESEL', '128.44L', '@', '1.899'),
                     ('TOTAL', '$36.20'),
                     ('GST', 'INCLUDED', '2.23'),
                     ('ABN', '46464680097')):
            with self.subTest(line=line):
                self.assertEqual(redact.find_in_document(self._doc(*line)), [])

    def test_a_line_hit_is_counted_once_not_per_span(self):
        # Otherwise MAX_REDACTIONS counts fragments and drops clean documents.
        hits = redact.find_in_document(self._doc('4111', '1111', '1111', '1111'))
        self.assertEqual(len(hits), 1)


class AnUnestablishedTruthIsOmittedNotGuessed(unittest.TestCase):
    """The false-truth bug, pinned.

    CORD's `menu` uses several key sets. An item lacking `nm`+`price` falls
    through the mapper, and the first version then asserted `line_count: 0` on a
    receipt that plainly showed two items — grading a correct reading of "2" as
    WRONG. Found by looking at the imported image, not by a test.
    """

    def setUp(self):
        from . import ingest
        self.ingest = ingest
        self.source = sources.get('cord-v2')

    def test_a_menu_we_could_not_map_is_flagged_incomplete(self):
        t = self.ingest.truth_from_cord({'gt_parse': {
            'menu': {'unitprice': '120,000', 'cnt': '1'},   # no nm, no price
            'total': {'total_price': '120,000'},
        }})
        self.assertEqual(t['lines'], [])
        self.assertFalse(t['lines_are_complete'])

    def test_a_fully_mapped_menu_is_complete(self):
        t = self.ingest.truth_from_cord({'gt_parse': {
            'menu': [{'nm': 'A', 'price': '1.000'}, {'nm': 'B', 'price': '2.000'}],
            'total': {'total_price': '3.000'},
        }})
        self.assertTrue(t['lines_are_complete'])

    def test_line_count_is_absent_from_the_entry_when_incomplete(self):
        t = self.ingest.truth_from_cord({'gt_parse': {
            'menu': {'unitprice': '120,000'},
            'total': {'total_price': '120,000'},
        }})
        entry = self.ingest.manifest_entry('x', self.source, 'p.png', t, 'clean', 0)
        self.assertNotIn(
            'line_count', entry['fields'],
            'an unestablished line_count must be OMITTED, never asserted as 0',
        )
        # And an engine reading two items is then not punished for being right.
        import scoring
        got = {n: s['truth'] for n, s in entry['fields'].items()}
        got['line_count'] = 2
        self.assertTrue(scoring.score_document(entry, got).field_pass())

    def test_every_entry_records_its_source_row(self):
        t = self.ingest.truth_from_cord({'gt_parse': {'total': {'total_price': '1.000'}}})
        entry = self.ingest.manifest_entry('x', self.source, 'p.png', t, 'clean', 42)
        # Document ids are sequential over IMPORTED rows and rows get skipped,
        # so the id is not the offset. Without this there is no way back.
        self.assertEqual(entry['source_row']['offset'], 42)
        self.assertEqual(entry['source_row']['dataset'], 'naver-clova-ix/cord-v2')
