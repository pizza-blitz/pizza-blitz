# Euron Open HRMS — Fit, Stability and Integration Review

**Reviewed repository:** [euron-sde-team/euron-open-hrms](https://github.com/euron-sde-team/euron-open-hrms)
**Reviewed commit:** `724c1e5` (23 Oct 2026)
**Review date:** 24 Oct 2026
**Reviewer:** Pizza Blitz engineering

---

## 1. Executive verdict

> **Direction update (24 Oct 2026):** Pizza Blitz now models HR as a **department**
> under the admin domain (`/departments/hr`), with its people, leave, payroll,
> onboarding, documents and exits modules listed but marked *planned*. The **People
> directory is live** at `/departments/hr/people` as the local employee mirror. Euron
> remains the external HR system behind that department. This preserves the
> recommendation below: one admin experience, a separate HR system of record, and no
> fake integration status.

Euron Open HRMS is a **credible, well-engineered HR/payroll codebase**, but it is **not a
drop-in replacement for Pizza Blitz’s workforce module** and it is **not proven “100%
stable.”**

The correct move is **selective adoption**:

> Run Euron as a **separate HR/payroll system of record** for the parts Pizza Blitz does
> not have — statutory payroll, payslips, onboarding, HR documents/letters, exits,
> performance, encrypted KYC/bank data and geofenced HR attendance — and keep Pizza Blitz
> as the system of record for restaurant operations: shift scheduling, labour-vs-sales,
> POS/KDS/delivery roles and permissions.

Do **not** copy its TypeScript domain into the Python backend, and do **not** replace the
whole Pizza Blitz workforce module. Build a thin integration adapter, not the HR domain.

---

## 2. What the project actually is

| Item | Finding |
|---|---|
| Product | Multi-tenant HRMS with tenant web app, operator console and Express API |
| Licence | **MIT** — commercial use/modification allowed with copyright notice; no warranty ([LICENSE](https://github.com/euron-sde-team/euron-open-hrms/blob/main/LICENSE)) |
| Backend | Node.js 22, Express, TypeScript strict, PostgreSQL 16, Kysely, SQL migrations |
| Frontend | Next.js 15, React 19, Tailwind 4 (Pizza Blitz is Next 14, React 18, Tailwind 3) |
| Infrastructure | AWS ECS Fargate, RDS, S3, KMS, SES, CloudFront/WAF, Terraform; local Docker emulator |
| HR scope | Employees/org chart, offices with geofences, attendance, leave, monthly payroll in country packs, payslips with QR verification, onboarding, documents/letters, exits, performance, assets, benefits, announcements, operator console |
| Security model | Repository-level tenant scoping, per-workspace KMS-wrapped PII encryption, TOTP, session revocation, audit, QR document verification |
| Release | **0.1.0**, first public release 22 Oct 2026; no GitHub Releases published |
| Repository age | Created **22 Oct 2026**; last push **23 Oct 2026** |
| Community | 6 stars, 7 forks, 0 open issues at review time; Git history/contributors observed: one author |

The README is unusually detailed and the architecture is coherent. This is not a toy
scaffold.

---

## 3. Is it “100% stable”? No — and the claim cannot be verified

### What is genuinely positive

- TypeScript strict, layered routes → controllers → services → repositories.
- Repository-level workspace scoping with isolation tests.
- PII encryption design (AES-256-GCM, per-workspace data keys, KMS, crypto-shredding).
- Decent attempt at production guardrails (refuses weak secrets, local mail/storage in prod).
- **Unit suite passed locally:** `pnpm test` → **752 tests passed**
  (API 678, console 11, web 30, api-client 25, UI 8).
- Upstream CI for the reviewed commit is green.

### What prevents a “100% stable” claim

1. **It is two days old.** A 0.1.0 released on 22 Oct 2026 with one observed author has no
   production track record, no long support history and no proven upgrade path.
2. **No GitHub Releases.** Releases API returned `[]`; distribution is “clone main.”
3. **The full quality pipeline does not run upstream.** The visible
   [`checks.yml`](https://github.com/euron-sde-team/euron-open-hrms/blob/main/.github/workflows/checks.yml)
   runs only lint, typecheck and unit tests. The repository itself says the full pipeline
   is opt-in and kept in `.github/workflows-full/` so it **does not run on the upstream
   repository** ([workflow README](https://github.com/euron-sde-team/euron-open-hrms/blob/main/.github/workflows-full/README.md)).
   That means the advertised integration, matrix, E2E, Terraform, security and image
   pipelines are **not continuously proven**.
4. **Integration/E2E were not independently run in this review.** Docker was not available
   on the review machine, so I did not run the 312 statically counted integration cases or
   the 11 browser cases. I ran only the unit suites. The README claims 758 unit and 394
   integration; my static count found ~752 unit and ~312 integration cases (parameterised
   tests can expand those counts, so treat the headline numbers as marketing until the full
   matrix is actually run).
5. **Single-maintainer risk.** Bus factor is currently one; no evidence yet of external
   security patching or a support process.
6. **No SSO, no public API keys, no webhooks.** Its own roadmap lists SSO as future work;
   machine-to-machine integration currently uses a human session JWT (7-day default).

**Conclusion:** treat it as a **promising 0.1.0 beta built by a capable team**, not as
“100% stable” infrastructure. A production payroll system needs a pilot and a support plan,
not a README claim.

---

## 4. Does it fill a Pizza Blitz gap? Partly — about half gap, half overlap

Pizza Blitz already has a workforce module, but it is operational, not statutory:

| Workforce area | Pizza Blitz today | Euron coverage | Decision |
|---|---|---|---|
| Staff login / POS permissions | Staff credentials + granular permission toggles | Separate user/role/RBAC system | **Keep Pizza Blitz** for POS/KDS/delivery access; link identity, don’t duplicate passwords |
| Shift roster / labour vs sales | Weekly schedule, shift log, labour % by day/role | **No shift scheduling, no labour-cost dashboard** | **Keep Pizza Blitz**; this is restaurant-specific and absent in Euron |
| Leave | Basic request + approve/reject | Types, balances, rules, carry-over, coverage, approvals, CSV export | **Adopt Euron**; sync approved leave into the roster |
| Attendance | “Attendance command” from shift data; no real clock/geofence | Geofenced check-in/out, worked minutes, day roster, regularisation | **Adopt Euron** for HR time; optionally keep shift clock for ops |
| Payroll | Hours × hourly-rate preview | Monthly salary structures, country rules, PF/ESI/PT, gratuity, payslips, QR verification | **Adopt for salaried staff**; **hourly crew is a gap** (see below) |
| Onboarding | Not built | Invites, self-onboarding forms, onboarding campaigns, document upload, reminders | **Adopt Euron** |
| HR documents/letters | Not built | Document vault, templates, offer/confirmation/relieving letters, QR verification | **Adopt Euron** |
| Exits / full-and-final | Not built | Resignation/termination/absconding, notice, settlement, access revocation | **Adopt Euron**; sync exit back to disable POS login |
| Performance / PIP | Not built | PIPs, appraisal cycles, work logs | **Adopt Euron** if needed |
| KYC/bank/PII at rest | Ordinary application data | AES-256-GCM, per-workspace keys, KMS, crypto-shredding | **Adopt Euron** for sensitive HR data |
| Org chart / offices | Store registry only | Departments, offices, reporting lines, org chart, geofences | **Map stores → offices**, roles → departments |

### The two decisive mismatches

1. **Euron payroll is monthly salaried payroll, not hourly restaurant payroll.**
   - Its payroll types explicitly say *“records only… no bank/payment integration”*
     ([payroll types](https://github.com/euron-sde-team/euron-open-hrms/blob/main/apps/api/src/domain/payroll/types.ts)).
   - Earnings are monthly structures; proration is by payable days. There is no evidence of
     hourly rate × attendance, overtime, service charge or tip pooling.
   - The India pack uses monthly PF/ESI/PT and **HR enters TDS manually**; it is a
     calculation aid, not a filing engine. It needs CA/legal validation.
   - Kitchen crew and riders are typically hourly/daily with overtime and tips. Euron
     cannot pay them correctly without an extension.

2. **Euron has no restaurant scheduling or labour-cost layer.**
   - No shift/schedule tables or endpoints were found; attendance is check-in/out, not a
     roster.
   - Pizza Blitz’s weekly roster and labour-vs-sales must stay, or be rebuilt on top of
     Euron — which would be building from zero in the opposite direction.

So: **the domain is not completely a gap.** Roughly half is already covered by Pizza
Blitz; the other half (statutory HR/payroll/compliance/onboarding/documents) is a real gap
that Euron fills well on paper.

---

## 5. How it should contribute to Pizza Blitz

### Recommended architecture: separate HR system + thin adapter

```text
Pizza Blitz (FastAPI + Next.js)
  ├─ POS / KDS / delivery / shift roster / labour %
  ├─ staff login + operational permissions
  └─ integration adapter (new, small)
        │  employees, exits, approved leave, payroll summary
        ▼
Euron Open HRMS (Node + Postgres + KMS/SES)
  ├─ HR employee master, KYC/bank (encrypted)
  ├─ onboarding, documents, letters, exits, performance
  ├─ leave balances/approvals
  ├─ geofenced attendance
  └─ monthly payroll + payslips (salaried)
```

**Do not share the database.** Both systems should own their schemas. Integrate through the
Euron HTTP API, not by reading its tables (PII is sealed and tenant-scoped).

### Mapping

| Pizza Blitz | Euron | Notes |
|---|---|---|
| Legal entity / brand | Workspace (`org_id`) | One workspace per company; do not create one per store |
| Store | Office | Set lat/lng/radius for geofenced attendance |
| Store department / role | Department | Used for scope and reporting |
| Staff ID | Employee `code` | Stable join key; email must be unique |
| Staff name/phone/email | Employee record | Sync on create/update |
| Employment type | `PERMANENT`, `TEMPORARY`, `INTERN`, etc. | Map crew to temporary/permanent appropriately |
| Exit/disable | Separation + access revocation | Sync back to Pizza Blitz |
| Approved leave | Leave request | Poll or export into roster |

### Integration mechanics — the awkward parts

- **No API keys or service accounts.** Euron only accepts tenant session JWTs (default 7
  days). The adapter needs a dedicated HR integration user, credential rotation and a
  re-login path. This is fragile; the clean fix is to contribute API-key support upstream.
- **No webhooks.** Employee/leave changes must be polled, or Pizza Blitz triggers sync on
  its own writes. Do not assume real-time.
- **No SSO.** Staff would have two logins initially. Options:
  1. Launch Euron separately and link from the Pizza Blitz portal (fastest).
  2. Contribute OIDC/SAML to Euron (its roadmap already lists SSO) and make Pizza Blitz the
     identity provider.
  3. Build a broker that mints Euron sessions after Pizza Blitz auth — only if unavoidable;
     it creates a security-critical custom auth path.
- **Different UI stack.** Euron is Next 15/React 19/Tailwind 4; Pizza Blitz is Next
  14/React 18/Tailwind 3. Do not try to embed its React components. Use its app as a
  separate HR portal or expose selected APIs behind Pizza Blitz screens.

---

## 6. Adoption plan

### Phase 0 — decision and pilot scope (1 week)

- Confirm one workspace per legal entity, not per store.
- Pick one store and 10–20 employees for a pilot.
- Write down the system of record for each field. Never dual-write without an owner.
- Get CA/legal review of the India payroll pack **before** any real payroll run.

### Phase 1 — run Euron standalone (1–2 weeks)

- Docker Compose locally; AWS dev later. Do not start with production payroll.
- Create the workspace, offices (stores), departments (roles).
- Import the pilot roster via CSV; verify codes/emails.
- Test leave, documents, onboarding and one **salaried** payslip.
- Confirm KMS/S3/SES and database backup/restore.

### Phase 2 — thin sync adapter (1–2 weeks)

- Sync employee create/update/exit from Pizza Blitz to Euron.
- Store the Euron employee ID against the Pizza Blitz staff record.
- Pull approved leave into the roster; show it on the shift planner.
- Disable Pizza Blitz POS access on exit.
- Add retry/idempotency and an audit log; never log PII.

### Phase 3 — payroll pilot (2–3 weeks)

- Salaried managers/admin only: run one parallel payroll cycle against the current process.
- Reconcile PF/ESI/PT/gratuity and net pay with the accountant.
- Publish payslips; test QR verification.
- Define a rollback: if reconciliation fails, no bank file is produced (Euron does not
  produce bank files anyway).

### Phase 4 — hourly crew decision (4–8 weeks if required)

Choose one, explicitly:

- **Extend Euron** with hourly pay mode, attendance-driven earnings, overtime and tips, or
- **Keep Pizza Blitz payroll preview for crew** and use Euron only for salaried staff and
  compliance records, exporting crew data to the accountant.

Do not claim “full payroll” until this decision is made; the current product cannot pay
hourly crew correctly.

### Phase 5 — identity and scale

- Add SSO or at least a single sign-on link and role mapping.
- Add API keys/webhooks upstream if deep automation is needed.
- Roll out store by store; monitor sync failures and payroll exceptions.

---

## 7. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| 0.1.0, single maintainer, no releases | Upgrade/security risk | Pin a commit, fork it, own the fork, run your own CI including integration/E2E |
| Full CI disabled upstream | Regressions unproven | Enable `.github/workflows-full` in your fork; run integration on Postgres and E2E before every upgrade |
| No SSO/API keys/webhooks | Integration friction and custom auth | Start with separate login + dedicated integration user; contribute API keys/OIDC upstream |
| Monthly salaried payroll only | Crew pay wrong/missing overtime/tips | Pilot salaried only; extend or keep crew payroll separate |
| Statutory rules need validation | Compliance/financial risk | CA/legal sign-off; treat TDS as manual; version and review rates yearly |
| AWS/KMS/SES lock-in | Ops cost/complexity | Run local/Postgres for pilot; budget AWS and KMS ownership |
| PII duplication | DPDP/privacy exposure | Minimise copies; keep sensitive data in Euron; encrypt transit; audit access |
| Two portals | Staff confusion | Deep link from Pizza Blitz, clear “HR portal” entry, later SSO |
| MIT/no warranty | Support risk | Keep copyright notice; commercial support is not included |

---

## 8. Final recommendation

1. **Do not build statutory payroll/HRIS from zero.** Euron is a strong starting point and
   is MIT-licensed.
2. **Do not adopt it wholesale.** It lacks the restaurant scheduling, hourly payroll,
   overtime, tips and POS-role integration that Pizza Blitz already has or needs.
3. **Adopt it as a standalone HR/payroll service** for salaried staff, leave, onboarding,
   documents, exits, performance and encrypted HR records.
4. **Build only the adapter** and, if needed, an upstream hourly-payroll extension.
5. **Run a 4–6 week pilot** with one store and salaried staff before calling it production
   ready.
6. **Reject the “100% stable” framing.** It is a promising beta; stability must be earned
   through the full test matrix, a pilot and a maintained fork.

### Go / no-go criteria for the pilot

- [ ] Integration and E2E suites pass in *our* fork, not just upstream.
- [ ] Employee/exit/leave sync is idempotent and audited.
- [ ] One salaried payroll reconciles to the current process with CA sign-off.
- [ ] KMS/S3/SES/backup/restore verified in the target region.
- [ ] Hourly crew path is explicitly decided (extend or keep separate).
- [ ] Security review of session/integration credentials and PII flow.
- [ ] Exit disables POS access within the agreed SLA.

---

## 9. Evidence collected in this review

- Repository metadata, licence, release list and CI runs via GitHub API (24 Oct 2026).
- Shallow clone at `724c1e5`; inspected API routes, migrations, payroll domain,
  attendance/leave services, auth middleware, workflows and docs.
- `pnpm install --frozen-lockfile` succeeded; `pnpm test` passed **752 unit tests**.
- Integration (312 statically counted) and browser (11) suites were **not run** because no
  Docker/Postgres runtime was available on the review machine. This is a limitation of the
  review, not a failure of the project.
- GitHub repository: <https://github.com/euron-sde-team/euron-open-hrms>
- README: <https://github.com/euron-sde-team/euron-open-hrms/blob/main/README.md>
- Licence: <https://github.com/euron-sde-team/euron-open-hrms/blob/main/LICENSE>
- Fast CI: <https://github.com/euron-sde-team/euron-open-hrms/blob/main/.github/workflows/checks.yml>
- Full CI (opt-in): <https://github.com/euron-sde-team/euron-open-hrms/blob/main/.github/workflows-full/README.md>
- Payroll scope: <https://github.com/euron-sde-team/euron-open-hrms/blob/main/apps/api/src/domain/payroll/types.ts>
- Attendance routes: <https://github.com/euron-sde-team/euron-open-hrms/blob/main/apps/api/src/routes/attendance.routes.ts>
