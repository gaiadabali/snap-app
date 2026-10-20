---
title: Reading every line and the GST split
url: /features
kind: product
---

## Every line, not just the total

Snap Apps reads each line of a docket: the item, its price, its quantity and whether it carries GST. That matters because a total on its own cannot tell a carton of milk from a hot pie.

## GST-free and taxable on one docket

Plain food is GST-free. Hot food and soft drink are not. One docket can carry both, so reading only the total would treat everything as taxable.

The demo docket on the site shows it. Milk, bread and eggs are GST-free. A hot pie, a soft drink and a flat white are taxable. Snap Apps adds the GST-free lines and the taxable lines separately and works out the GST on the taxable lines only.

## How the GST is worked out

GST on a taxable line is one eleventh of its GST-inclusive price. GST-free lines are left out of that sum.

If the whole docket were read as a total and treated as taxable, it would assume more GST than was ever charged, which means claiming GST that was never paid. Reading line by line avoids that over-claim.

## Versioned readings

Each reading is saved as a numbered version of the same photo. When the reader improves, your history can be read again, and the old versions stay so a change is something you can inspect rather than a silent correction.

## Frequently asked

### Can it tell GST-free items from taxable ones?
Yes. It reads the tax treatment of each line, so a mixed docket is split into its GST-free and taxable parts.

### Why are some lines on my docket GST-free?
Basic food such as milk, bread and eggs is GST-free. Hot food, soft drinks and most other goods carry GST.

### Does it read the total only?
No. It reads every line, then checks that the lines add up to the total on the docket.
