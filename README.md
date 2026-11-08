# MandateGRC: policy-first GRC workbench

**MandateGRC** is a self-hosted Governance, Risk & Compliance workbench for GRC analysts. It is built around the anatomy of a professional security policy and its golden rules:

> Use **"must" and "shall"** (never "should" or "we try to"), keep statements **specific and measurable**, and **map each policy to a framework**.

The name comes from the first golden rule. A policy is a *mandate*: it says what must happen, not what we hope will happen.

---

## Deploying

See **[DEPLOY.md](DEPLOY.md)** for requirements and step-by-step deployment to mandategrc.app (Fly.io, a VPS with Docker + Caddy, or Railway/Render).

## Quick start

Requirements: **Node.js 22.13 or newer**. There is nothing to `npm install`: MandateGRC has zero third-party dependencies.

```bash
npm start
```

Open **http://localhost:4300**. Use `localhost`, not `127.0.0.1`: passkeys require a domain name.

1. Click **Get started**, enter your organization name and a username, and create a passkey with Face ID, Touch ID, Windows Hello or a security key. You get your own private workspace and are its administrator. Sample data is optional.
2. Invite colleagues from **Users & roles → Invite someone**. They open the link, choose a username and create their own passkey.

MandateGRC is **multi-tenant**. Every policy, risk, exception, evidence item, user and audit entry belongs to exactly one workspace, and every query is filtered by the signed-in user's workspace. Each workspace has its own audit hash chain.

| Variable | Default | Purpose |
|---|---|---|
| `MANDATE_ORIGIN` | – | **Set this in production**, e.g. `https://mandategrc.app`. It pins the passkey relying party (domain) and the expected origin. |
| `PORT` / `HOST` | `4300` / `127.0.0.1` | Listen address |
| `TLS_CERT`, `TLS_KEY` | – | Paths to PEM files; enables HTTPS, Secure cookies and HSTS |
| `TRUST_PROXY=1` | off | Trust `X-Forwarded-Proto` when behind a reverse proxy |
| `MANDATE_DATA_DIR` | `./data` | Location of the SQLite database |

To start completely fresh, stop the server and delete the `data/` folder.

## Passwordless by design

MandateGRC has **no passwords and no email addresses**. Identity is a username plus one or more **passkeys** (WebAuthn / FIDO2).

- **Biometrics stay on the device.** Face ID, Touch ID and Windows Hello unlock a private key in the device's secure hardware. The server stores only the public key and verifies signatures (ES256, EdDSA or RS256) with Node's built-in crypto.
- **Phishing-resistant.** Passkeys are bound to the domain. User verification is required, and signature counters detect cloned authenticators.
- **Open sign-up, private workspaces.** Anyone can create a workspace. Joining an existing workspace needs a one-time invite (100 bits of entropy, stored hashed, single use, expires in 1–14 days), so strangers can never get into yours.
- **Lost device?** An administrator issues a 24-hour recovery code, optionally revoking the old passkeys. Users can register several passkeys (laptop, phone, security key) from **My account**.
- **Public site.** The landing page, sign-in, register, privacy policy and terms of service are served at `/#/`, `/#/login`, `/#/register`, `/#/privacy` and `/#/terms`.

## Privacy

- **Stored:** a username, an optional display name, passkey public keys, the workspace's own GRC content, and an audit trail of who did what and when.
- **Never stored:** passwords, emails, phone numbers, biometrics, IP addresses, user agents, analytics or third-party scripts.
- **Rate limiting** uses hashed client addresses held in memory for at most 15 minutes.

The full text is on the privacy page.

## Documentation

The illustrated user guide lives at **/#/docs**. It's linked from the navbar, the footer and the in-app sidebar ("Documentation"). It has 23 guides covering getting started, writing, approving, publishing and retiring policies, the policy-writing style guide, the template library, risks, exceptions, frameworks, evidence, the audit trail, team management, troubleshooting and a glossary. It includes about 50 step-by-step screenshots, which you can click to enlarge, and it has a search box.

- Content: `public/js/docs-content.js` (plain data, easy to edit)
- Page: `public/js/docs.js`
- Screenshots: `public/docs/img/`. After UI changes, regenerate them all with:

```bash
node tools/docs-screenshots.mjs
```

The script starts a throwaway instance on port 4399 with sample data, signs up using a test-only software passkey, drives headless Chrome through every flow, and captures each step. It needs Google Chrome; set `CHROME=/path/to/chrome` to use another Chromium browser. It never touches your real data.

## Onboarding

On first sign-in, each user gets an animated welcome and a guided tour. It shows the 8-part anatomy and the three golden rules, then a spotlight tour moves through the app, ending with suggested first actions.

- **Tailored to each role.** Analysts and admins get 12 stops (dashboard → templates → the editor's anatomy, linter and workflow → frameworks → risks → exceptions → audit trail). Approvers, auditors and employees get shorter tours.
- **Navigation:** arrow keys move between stops and Esc skips. Replay the tour any time from the **?** button in the top bar.
- **Completion is saved per user** on the server and recorded in the audit trail.
- **Respects reduced motion:** the animations are turned off when the operating system's `prefers-reduced-motion` setting is on.

## Policy review: substance, not just form

Beyond the linter, every policy gets a **Review report** (editor card, approval dialog, document-view appendix and Markdown export) with a verdict (**Ready / Needs work / Not ready**) and five scores:

- **Structure and Language**: the anatomy and must/shall rules below.
- **Coverage**: must-have topics for 7 policy types (Access Control, Acceptable Use, Incident Response, Data Classification, Backup, Vulnerability Management, Third-Party Risk). Each gap offers a suggested statement, already mapped to its controls, that you insert with one click.
- **Benchmarks**: numbers in statements (password length, lockout, session timeout, patch deadlines, leaver revocation, access reviews, backups, breach notification, log retention, TLS/AES…) compared with baselines from PCI DSS v4.0, NIST, ISO/IEC 27001, GDPR and CIS. Weaker values are flagged with their source.
- **Consistency**: the owner appears in Roles; every actor given duties has a role; statements don't contradict each other; values agree with the workspace's other published policies.

The server enforces the same review. A **Not ready** policy (blocking issues, or under half the must-have topics) cannot be submitted, and an approver must explicitly accept any remaining coverage gaps, which are recorded in the audit trail. All rules live in `public/js/criteria.js`, and the review runs locally, with no AI and no third-party service.

## The 8-part policy anatomy, enforced

The policy editor *is* the anatomy. Every policy has the eight sections in order, a live linter scores it as you type, and blocking issues must be cleared before it can be submitted for approval.

| # | Section | What MandateGRC does |
|---|---|---|
| 1 | **Header** | Name, owner, classification, effective date, review cycle (annual recommended). The version and approval are recorded automatically by the workflow, never typed by hand. |
| 2 | **Purpose** | Flags multi-paragraph or thin purposes and checks that the "why" is stated. |
| 3 | **Scope** | Checks that the scope says *who* (employees, contractors…) and *what* (systems, data…). |
| 4 | **Policy Statements** | Numbered 4.1, 4.2… Every statement needs "must/shall". Flags "should", "may", "try to", "where possible", "periodically", "timely", "adequate", "strong encryption" and similar wording, with one-click fixes. Warns when a statement has no measurable criterion. |
| 5 | **Roles & Responsibilities** | Checks for Owner, Custodian, Users and Management; one click adds any that are missing. |
| 6 | **Compliance & Enforcement** | Checks for consequences, a verification method and the exception process. |
| 7 | **References** | Generated from statement-level control mappings and grouped by framework. |
| 8 | **Revision History** | Each approval writes an immutable snapshot with version, author, approver and change summary. Any two versions can be diffed. |

---

## What existing tools lack, and what MandateGRC adds

| Tool(s) | Commonly reported gaps | MandateGRC's answer |
|---|---|---|
| **Vanta, Drata, Secureframe** | Generic policy templates and weak policy-quality guidance; cross-framework mapping that "doesn't actually cross map"; SaaS-only; steep renewal pricing; SOC 2 bias | Policy linter that enforces the professional anatomy; **statement-level** mappings across 8 frameworks with theme-based crosswalk suggestions; self-hosted, so data never leaves your infrastructure |
| **ServiceNow IRM, Archer, MetricStream** | Heavy implementations, consultants needed, complex UIs, enterprise pricing | Runs with `npm start`, with no database server and no dependencies; opinionated, guided workflows |
| **LogicGate, Hyperproof, AuditBoard** | Steep learning curve; heavy admin setup; manual reporting configuration; over-permissioned integrations | Works out of the box with a live posture index and a personal action queue; no external integrations requesting permissions |
| **Eramba (open source)** | Technical setup and maintenance; steep learning curve; APIs only in the paid edition | Single Node process; modern UI; full JSON API in every install |
| **CISO Assistant (open source)** | Strong on framework libraries, light on policy authoring and quality | Policy authoring is the core: anatomy editor, linter, approval workflow, attestation |
| **NAVEX / PolicyTech / ConvergePoint** | Policy lifecycle without risk or control traceability | Policy → statement → control → evidence → risk traceability in one model |

Capabilities that are rare or missing across the market:

- **Policy linter.** "Must/shall" enforcement, measurability checks, one-click fixes, a 0–100 quality score, and blocking issues gate the workflow on the server.
- **Statement-level traceability.** Coverage shows exactly which policy statement satisfies each control, not just "policy X covers control Y".
- **Theme-based crosswalk.** Mapping a statement suggests equivalent controls in the other frameworks and reads the statement text to propose relevant controls.
- **Separation of duties, enforced.** Authors cannot approve their own policies or exceptions, and the server records attempts to do so.
- **Tamper-evident audit trail.** Entries are SHA-256 hash-chained, SQLite triggers make the table append-only, and an integrity check runs on demand.
- **Exceptions done properly.** Each exception is tied to a specific statement, needs compensating controls before approval, expires within 365 days, and shows a countdown and an auto-"Expired" state.
- **Version-aware attestation.** A new published version automatically re-opens acknowledgement. While a revision is in progress, employees keep seeing the version currently in force.
- **Risk register with appetite and quantification.** 5×5 inherent and residual heat maps, an appetite threshold, and optional SLE × ARO = ALE.
- **Evidence freshness.** Each evidence item has a validity window; stale evidence surfaces in the action queue before an auditor finds it.
- **GRC Posture Index.** One explainable number built from policy quality, coverage, evidence freshness, risk within appetite and attestation.
- **Custom frameworks.** Paste a CSV catalogue (for example DORA, NIS2, CMMC or customer contracts) and it joins the crosswalk.
- **Clean exports.** Print-ready policy documents (serif document view, print to PDF), Markdown and JSON exports, and an audit CSV export with formula-injection protection.

---

## Control register & testing

Policies state intent; controls prove operation. Each control in the register links the policy statements it implements and the framework requirements it satisfies, has an owner and a test frequency, and carries its test history and evidence. Designs are approved by someone other than their author; the design approver cannot test the control; a failed test opens a failure that only someone other than the tester can close. Every step is written to the hash-chained audit trail.

Schema changes are versioned migrations (`src/migrations.js`): additive, backed up before they run, and reversible with `node tools/migrate.mjs down <id>`.

## Roles

| Role | Can |
|---|---|
| Administrator | Everything, including users and settings |
| GRC Analyst | Author policies; manage risks, controls, evidence and exceptions |
| Approver | Approve or return policies; decide exceptions (never their own) |
| Auditor | Read everything, verify and export the audit trail |
| Employee | Read policies in force; acknowledge them |

---

## Security design

- **Authentication.** Passkeys only (WebAuthn with user verification required). Every challenge is single-use and expires after 5 minutes. Origin and relying-party ID are checked, cloned authenticators are detected, and invite and recovery codes are one-time and hashed.
- **Sessions.** 256-bit random tokens stored only as SHA-256 hashes, with no IP address or user agent; `HttpOnly` + `SameSite=Strict` cookies (`Secure` under TLS); 30-minute idle and 8-hour absolute timeouts. Sessions are revoked on role change, deactivation or passkey revocation.
- **Request integrity.** A CSRF token is required on every state-changing request, together with Origin verification and a JSON-only content type.
- **Browser hardening.** A strict CSP with no inline script or style (`default-src 'self'`, `frame-ancestors 'none'`), plus `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, a restrictive `Permissions-Policy`, COOP/CORP, and HSTS under TLS.
- **Output safety.** All UI rendering goes through an auto-escaping template function. Evidence links are only rendered as links when they are `http(s)`, and `javascript:`/`data:` URLs are rejected on input.
- **Server-side authorization.** Every API route declares its allowed roles. Input is validated for type, length, enum and date. All SQL is parameterized. Request bodies are capped at 1 MB. Static files are protected against path traversal.
- **Data at rest.** The SQLite database file has mode 0600 and `secure_delete` enabled. No files are uploaded: evidence is stored as references to systems of record.
- **Supply chain.** There are no npm dependencies at all.

For production: put MandateGRC behind TLS (`TLS_CERT`/`TLS_KEY` or a reverse proxy with `TRUST_PROXY=1`), back up `data/mandate.db`, and restrict network access to your corporate network or VPN.

---

## Tests

```bash
npm test
```

Unit tests cover the policy review (scoring, categories, measurability, owner resolution) and the control crosswalk; API tests start a throwaway server with its own data directory and sign in with a software passkey. `npm run docs:screenshots` drives the whole app in headless Chrome as an end-to-end check.

## Project layout

```
server.js              HTTP server, routing, security headers, static files
src/api.js             REST API: auth, policies & workflow, risks, exceptions, controls, evidence, audit, users
src/security.js        Sessions, one-time codes, rate limiting, headers
src/webauthn.js        Passkey relying party: CBOR/COSE parsing, signature verification
src/audit.js           Hash-chained audit trail and verification
src/db.js              SQLite schema (node:sqlite)
src/frameworks.js      Built-in control catalogues with crosswalk themes
src/templates.js       Lint-clean policy templates
src/seed.js            First-run bootstrap and demo workspace
public/js/lint.js      Policy linter, shared by the browser and the server
public/js/core.js      Escaping templates, API client, modals, icons
public/js/public.js    Landing page, passkey sign-in/register, privacy & terms
public/js/passkey.js   Browser side of the WebAuthn ceremonies
public/js/onboarding.js Animated welcome and guided tour
public/js/views/*.js   Dashboard, policies, risks, exceptions, frameworks, evidence, attestations, audit, admin
public/css/app.css     Dark design system and print stylesheet
```
