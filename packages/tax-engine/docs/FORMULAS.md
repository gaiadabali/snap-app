# Longhaul Truckie — Formula Reference (from client spreadsheet)

## Constants
- CPK (cents/km) rate: **$0.88/km**, capped at **5,000 km** by law
- Car depreciation: car cost / **8 years**; valuation capped at **$69,674** → max claim **$8,709.25/yr**
- Meals reasonable limit (TD 2025/4): **$165/day** (income < $148,250) · **$201.35/day** (income ≥ $148,250)
  - Breakdown: Breakfast 34.75 · Lunch 39.10 · Dinner 66.65 · Incidentals 24.50 = 165.00
- Home laundry: **$3/week**
- Home office electricity: **$0.70/hr**
- Overtime meal (max w/o receipts): **$38.65/day** (spreadsheet value — use this, not brief's 37.65)

## D1 — Car
- Logbook: `(totalExpenses + declineInValue) × logbook%`
  - declineInValue = min(carCost, 69674) / 8
  - logbook% = workKs / totalKs
  - totalExpenses = sum of itemised rows (fuel, rego, insurance, loan interest, tyres, servicing, car-wash items, improvements/8 …)
- Cents/km: `min(km, 5000) × 0.88`
- Fuel estimate: `totalKs / perXks × litres × avgPricePerL`
- Loan interest estimate: `(repayment × paymentsPerYr × years + balloon) − amountBorrowed`, ÷ years

## D2 — Travel
- accommodation = nights × ratePerNight
- meals = fortnightTotal × numberOfFortnights(weeks/2); fortnightTotal must be ≤ daysWorked × 165
- tolls = (tollToWork + tollHome) × roundTrips
- + parking + other

## D3 — Clothing & Laundry
- items: Σ(qty × $/item)
- home laundry: weeksWorked × 3
- travel laundry: Σ(qty × costPerUse)

## D5 — Other
- overtime meals = (weeksWorked × otDaysPerWeek − daysOff) × 38.65
  - weeksWorked = weeksAtJob − fullWeeksOff
- phone = costPerMonth × months × workUse%
  - workUse% = totalWorkHours / totalAllHours
  - workHours = (workHrDuringWorkDays) + (workHrDuringDaysOff); allHours adds the two private buckets
- home office electricity = hours × 0.70
- + PPE, bedding, hand tools, licenses, logbooks/stationery, union fees, truck maintenance supplies

## D9 Donations · D10 Tax costs · D12 IPP · D14 Super
- Simple sums.
- D10 rows: last year's return fee, other years lodged this FY, bookkeeping, other
- D14 Super: amount + Superfund Name + Member Number fields

## Occupation benchmarks (max | common)
- Traveling Truckie (line haul): 100,000 | 40,000–55,000
- Local Truckie (home daily): 43,000 | 33,000
- Tradies: 43,000 | 31,000
- Miners: 43,000 | 32,000
- Carers: 36,000 | 21,000
- Office Workers: 21,000 | 16,000
- Overtime Workers: 20,000 | 11,000
- Sole Traders (ABN): 69,000 | 46,000 (note: company structure can save 50–65%)
- Rental Owners / Tithers: no max (10k–20k / 6k–8k)
