# Transport changes — 6 November 2026

Existing theme, colours and core workflows remain. These are supplemental master mappings, audit fields and targeted correctness fixes. Normal configured school data was not reset or migrated during implementation; tests use disposable PostgreSQL.

## Vehicle master and audit

- Vehicle model family, vehicle type and fuel type are selected from tenant-owned institution masters. Seeded model families: Tata Starbus, Ashok Leyland Sunshine, Force Traveller N School Bus and Eicher Skyline Pro Next. Fuel options include CNG, diesel, petrol, electric, LPG and hybrid. Administrators may add more master values; capacity is entered from the RC rather than inferred from a model family.
- Registration uses the existing Indian normalization/format validator, wired into the real vehicle API. Duplicate format variants are checked against the existing fleet. Format acceptance does not mean government registry verification. New BH-series classifications cannot be presented as school transport; non-transport vehicles cannot receive student allocations.
- Optional audit fields: owner/operator, ownership type, RC reference, manufacture year, odometer, insurance policy number, permit number and permit/fitness/PUC/tax validity dates. Insurance expiry and operational status remain in the existing master.
- Vehicle creation/update, profile persistence and audit are transactional. Linked master IDs are school-scoped; inactive values already in use remain usable on historical records while new selection of inactive masters is blocked.

## Maintenance register

Essential fields: vehicle, description, status and the date appropriate to that status. New UI records also select a service/job type. Completed work has a performed date; scheduled work has a planned date and no invented completion date. Future completed work is rejected. Legacy payloads remain compatible.

Optional supporting details: linked vendor/garage, job card/work order, invoice number/date, service odometer, parts/materials and labour, invoice GST percentage, payment reference, repair warranty, next-service date/km and an existing procurement expense ID. Costed new-profile entries need an invoice, job card or linked expense reference. A supplied parts/labour/GST breakdown determines the authoritative server total. Linked expense amount/vendor must match. Recording maintenance never posts an expense or payment, preventing duplicate financial counting. The saved list displays job/invoice/next-service references.

## Route tariffs, allocation and renewals

- Fixed the route fee-head picker: transport managers use a narrow transport lookup instead of needing broad finance permission. Only active transport fee heads are offered; vendor lookup exposes labels without private finance/contact fields.
- Added route tariff periods (monthly, term, annual or one-time), amount, fee head, start/end and optional policy/approval reference. Overlapping active tariff date ranges are rejected under a route lock. Old tariff periods are closed, not silently overwritten. A quoted tariff does not automatically create a charge or mark a student paid.
- Allocation can record validity and a30/60-day renewal reminder window. Individual and bulk allocation share the same serialized server checks. Capacity is counted across all active allocations on every route sharing a vehicle, fixing a per-route over-allocation gap. Ended history is retained. Expiry does not silently end an allocation; the school resolves the due list.
- Bulk CSV import has preview and explicit apply. Required columns are admission_number, route_code and stop_sequence; optional columns are effective_from, valid_until, reminder_days and payment_reference. Existing identity/route/stop IDs are reused. Duplicate students, invalid dates, missing references, unavailable vehicles and shared-vehicle capacity overflow are rejected. Commit repeats validation in one transaction; no partial import occurs. An identical existing allocation remains unchanged. Paid flags are rejected; a payment reference is only verified against actual recorded transport payments and never creates a payment.
- Parent and student portals read the same actual allocation, route, stop, driver, quoted tariff, validity and posted central transport fee data. No parallel student or fee ledger is created. Refunds on associated payments produce an explicit finance-review status rather than a fabricated paid balance.
- Families can request renewal; an authorised transport allocator approves/rejects with a note. Self-review is blocked, duplicate pending requests are blocked, and approval updates the existing allocation validity with an audit trail. It does not collect money or create a financial charge.
- In-application due lists show expiring allocations and supplied vehicle document dates. No SMS, WhatsApp or email provider is configured and no external reminder was sent.

## Truthful telemetry

The former hardcoded live GPS/stale-ping/ETA panel was replaced by an explicit “not connected” integration state plus actual registered fleet and planned route schedules. No tracker feed exists in the current repository. Scheduled times do not prove live position or boarding.

## Validation

Targeted integration suite: `npx vitest run apps/api/test/transport-operations.test.ts` —7/7 passed on the final targeted rerun (59.86 seconds), including costed maintenance reference and narrow transport-manager lookup checks. The final root run additionally covers the complete application. Coverage includes registration/master scope/BH use, planned/performed maintenance and GST, tariff overlaps, non-mutating bulk preview and commit, duplicate/paid-reference safety, shared-vehicle capacity, parent isolation and renewal review. API and web typechecks passed during implementation; global build/browser validation are owned by the parent task and should be read from its final report. Transport-file lint reported0errors and0warnings.

## Sources and limits

Registration marks and state-code conventions: https://transport.telangana.gov.in/html/registration-statecodes.html and https://morth.gov.in/sites/default/files/Appendices%20.pdf

BH scheme: https://morth.gov.in/sites/default/files/notifications_document/GSR%20594%28E%29%2026%20.08.2021%20BH%20series%20registration%20mark%20Rules.pdf

School vehicle document example (West Bengal guidance, not an all-India compliance declaration): https://transport.wb.gov.in/wp-content/uploads/2024/06/Advisory_on_the_Operation_of_School_Buses_and_Pool_Cars_0001.pdf

Model family references (no seating/fuel specification inferred):
- https://busesandvans.tatamotors.com/brand/starbus
- https://www.ashokleyland.com/in/buses/brands/sunshine
- https://www.forcemotors.com/vehicles/school-buses/
- https://www.eichertrucksandbuses.com/buses/school-bus/skyline-pro

This work does not provide VAHAN verification, a live GPS integration, universal state school-bus compliance, automatic transport billing, external payment verification or outbound reminder delivery. Those require applicable school policy and the relevant integrations. Tariffs and financial charges remain separately auditable.
