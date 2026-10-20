---
title: Security and how records are protected
url: /legal/security
kind: policy
---

## Your workspace is walled off

Every workspace is a separate tenant at the database level. Row-level security policies on every tenant-scoped table mean another account's query cannot reach your rows. The database enforces it, not only the app.

## The original is never altered

The original receipt image is retained unmodified, never recompressed or edited. The ATO only accepts an electronic record if it is a true and clear reproduction of the original. A separate normalised copy is made for reading.

## Exact money

Amounts are kept as exact decimals from the camera to your screen, never rounded through floating point. A cent out is a wrong answer.

## Reading is versioned and replayable

Every reading is a numbered version of the photo. When the reader improves, history can be read again and the old versions stay.

## Balanced records

Every posted entry adds up to zero or it is refused. The database itself turns away an entry that does not balance.

## Encryption and sensitive fields

Data is encrypted in transit (HTTPS). The server's disk is not yet encrypted at rest; that is planned with the move to Australian hosting. Particularly sensitive fields receive an extra layer of application-level encryption.

## Audit trail and breaches

An append-only audit trail records who accessed what, so the scope of a suspected breach can be established quickly. Where a breach is likely to cause serious harm, the aim is to notify affected people and the OAIC.

## Reporting a security issue

If you think you have found a vulnerability, report it through support rather than testing it against another customer's data.

## Frequently asked

### Can other users see my receipts?
No. Row-level security in the database keeps each workspace's rows separate.

### Is my original photo ever changed?
No. It is kept exactly as taken.

### How do I report a security problem?
Through support, at the help centre or by email.
