"""Confidence-versus-error correlation — the input D20 calibration needs.

`Provenance.calibrated` (docdom.ts) exists to distinguish a probability an
engine can back up from a fluent generative guess. Nobody can flip it to
`true` honestly without evidence that reported confidence actually tracks
correctness. This module produces that evidence; it does not itself decide
whether an engine is calibrated (that is a modelling exercise -- Platt
scaling, isotonic regression -- explicitly out of scope for D20, which this
only feeds).

Two views, deliberately both:

  - `pearson_confidence_correctness` -- one number, the Pearson correlation
    between reported confidence and per-region correctness (1 - CER, clipped
    to [0, 1]). Positive and large means confidence is USEFUL SIGNAL even if
    not calibrated; near zero means it is closer to noise; `None` when there
    are fewer than 2 matched regions (undefined, not zero -- see below).
  - `reliability_buckets` -- the standard calibration-curve input: bucket
    matched regions by confidence decile, report mean confidence and mean
    correctness per bucket. A calibrated engine's two columns match; this
    module only ever reports what they ARE, never whether they match well
    enough to call it calibrated.

Both only consider regions where the engine actually produced a reading
(abstentions and misses have no confidence to correlate against, and folding
them in as confidence=0 would invent a number for something the engine did
not report).
"""
from __future__ import annotations

import statistics
from dataclasses import dataclass, field


@dataclass
class CalibrationPoint:
    confidence: float
    correctness: float  # 1 - CER, clipped to [0, 1]


def pearson_confidence_correctness(points: list[CalibrationPoint]) -> float | None:
    """`None` when there are fewer than 2 points, or when confidence (or
    correctness) is constant across all of them -- Pearson's r is undefined
    in both cases, and `statistics.correlation` raises `StatisticsError`
    rather than silently returning 0.0. Reporting `None` here instead of
    catching-and-zeroing keeps that distinction visible to the caller.
    """
    if len(points) < 2:
        return None
    confidences = [p.confidence for p in points]
    correctness = [p.correctness for p in points]
    if len(set(confidences)) < 2 or len(set(correctness)) < 2:
        return None
    return statistics.correlation(confidences, correctness)


@dataclass
class ReliabilityBucket:
    lo: float
    hi: float
    n: int
    mean_confidence: float | None
    mean_correctness: float | None


def reliability_buckets(points: list[CalibrationPoint], n_buckets: int = 5) -> list[ReliabilityBucket]:
    """Fixed-width buckets over [0, 1], not quantile buckets — quantile
    buckets would move their own boundaries depending on the score
    distribution, which makes two runs' reliability diagrams incomparable.
    Empty buckets are reported with `n=0` and `None` means, not omitted:
    an engine that never reports confidence below 0.5 is itself a finding.
    """
    edges = [i / n_buckets for i in range(n_buckets + 1)]
    buckets = []
    for i in range(n_buckets):
        lo, hi = edges[i], edges[i + 1]
        in_bucket = [p for p in points if (lo <= p.confidence < hi) or (i == n_buckets - 1 and p.confidence == hi)]
        if in_bucket:
            mean_conf = sum(p.confidence for p in in_bucket) / len(in_bucket)
            mean_corr = sum(p.correctness for p in in_bucket) / len(in_bucket)
        else:
            mean_conf = None
            mean_corr = None
        buckets.append(ReliabilityBucket(lo=lo, hi=hi, n=len(in_bucket), mean_confidence=mean_conf, mean_correctness=mean_corr))
    return buckets
