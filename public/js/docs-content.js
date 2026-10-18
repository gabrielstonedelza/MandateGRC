// MandateGRC documentation content. Screenshots live in /docs/img and are regenerated with
// `node tools/docs-screenshots.mjs`. Block types: p, steps, tip, warn, list, table, compare, templates.
const img = (name) => `/docs/img/${name}.jpg`;

export const DOC_GROUPS = ['Getting started', 'Policies', 'Risk & compliance', 'Assurance & admin', 'Help'];

export const DOCS = [
  // ===================================================================== Getting started
  {
    id: 'overview', group: 'Getting started', title: 'What is MandateGRC?', minutes: 3,
    summary: 'A tour of the product, the roles, and the rules every policy follows.',
    blocks: [
      { p: 'MandateGRC is a governance, risk and compliance (GRC) workbench built around how professional security policies are written. You draft policies section by section, a linter checks your wording as you type, every statement is mapped to the frameworks you report against, and every action is recorded in a tamper-evident audit trail.' },
      { figure: img('01-landing'), caption: 'The MandateGRC home page. Click "Get started" to create a workspace, or "Sign in" if you already have one.' },
      { h: 'The 8-part policy anatomy' },
      { p: 'Every policy in MandateGRC has the same eight sections, always in this order. The editor is laid out exactly like this, and each section turns green when it meets the standard.' },
      { table: { head: ['#', 'Section', 'What it contains'], rows: [
        ['1', 'Header', 'Policy name, version, owner, effective date, review cycle (annually), approval'],
        ['2', 'Purpose', 'One paragraph: why this policy exists'],
        ['3', 'Scope', 'Who and what it applies to (employees, systems, contractors)'],
        ['4', 'Policy Statements', 'The actual rules, numbered, written as "must / shall" statements'],
        ['5', 'Roles & Responsibilities', 'Who does what (owner, custodian, users, management)'],
        ['6', 'Compliance & Enforcement', 'What happens if someone violates it'],
        ['7', 'References', 'The frameworks it maps to (NIST, ISO 27001, …)'],
        ['8', 'Revision History', 'The version table'],
      ] } },
      { h: 'The three golden rules' },
      { list: [
        '<b>Use "must" and "shall"</b>, never "should" or "we try to".',
        '<b>Keep statements specific and measurable</b>: a frequency, a deadline, a threshold or a named standard.',
        '<b>Map each policy to a framework</b> so it reads as auditable compliance work.',
      ] },
      { h: 'Roles' },
      { table: { head: ['Role', 'What they can do'], rows: [
        ['Administrator', 'Everything, including inviting people, changing roles and workspace settings.'],
        ['GRC Analyst', 'Write and edit policies; manage risks, exceptions, frameworks and evidence.'],
        ['Approver', 'Approve or return policies and decide exceptions. Never their own work.'],
        ['Auditor', 'Read-only access to everything, including verifying and exporting the audit trail.'],
        ['Employee', 'Read the policies in force and acknowledge them.'],
      ] } },
      { tip: 'Separation of duties is always enforced: whoever wrote or submitted a policy cannot approve it. Plan for at least two people (an author and an approver) before you publish your first policy.' },
    ],
  },
  {
    id: 'create-workspace', group: 'Getting started', title: 'Create your workspace', minutes: 2,
    summary: 'Sign up with a username and a passkey. No email, no password.',
    blocks: [
      { p: 'A workspace is your organization\'s private space in MandateGRC. Only you and the people you invite can see it. Creating one takes about a minute.' },
      { steps: [
        { t: 'Open "Get started"', d: 'Go to <b>mandategrc.app</b> and click <b>Get started</b> in the top-right corner of the navigation bar.', img: img('01-landing') },
        { t: 'Describe your workspace', d: 'Enter your <b>organization name</b> and choose a <b>username</b>. MandateGRC checks availability as you type: wait for the green "is available" message. A display name is optional. Keep <b>Include sample policies, risks and evidence</b> ticked if you want realistic examples to explore.', img: img('02-signup') },
        { t: 'Create your passkey', d: 'Click <b>Create passkey &amp; workspace</b>. Your device asks you to confirm with <b>Touch ID, Face ID, Windows Hello</b>, your phone, or a security key. Approve it. Your fingerprint or face never leaves your device; MandateGRC only receives a public key.' },
        { t: 'Meet the welcome tour', d: 'You land in your new workspace as its <b>Administrator</b>. A short welcome explains the policy anatomy. Click <b>Take the tour</b>.', img: img('04-welcome') },
        { t: 'Follow the spotlight', d: 'The tour highlights each part of the app and explains it. Use <b>Next</b> (or the → key) to continue, or <b>Skip tour</b>. Replay it any time from the <b>?</b> button in the top bar.', img: img('05-tour') },
      ] },
      { tip: 'Add a second passkey (for example your phone) from <b>My account</b> straight away, so you can still sign in if you lose this device. See <a href="#/docs/account">Your account &amp; passkeys</a>.' },
    ],
  },
  {
    id: 'sign-in', group: 'Getting started', title: 'Sign in with a passkey', minutes: 1,
    summary: 'One click and a fingerprint. No password to remember.',
    blocks: [
      { steps: [
        { t: 'Open Sign in', d: 'Click <b>Sign in</b> in the navigation bar.', img: img('03-signin') },
        { t: 'Approve with your device', d: 'Click <b>Sign in with passkey</b> and approve with Touch ID, Face ID, Windows Hello or your security key. Your browser shows the passkeys saved for MandateGRC; pick yours.' },
        { t: 'Using a security key or another device?', d: 'Expand <b>Using a security key or another device?</b> and type your username first. MandateGRC then asks your browser for that account\'s passkey specifically.' },
      ] },
      { warn: 'Sessions end after 30 minutes of inactivity (your administrator can change this) and always after 8 hours. Just sign in again; your work is saved on the server.' },
    ],
  },
  {
    id: 'dashboard', group: 'Getting started', title: 'Read the dashboard', minutes: 3,
    summary: 'Your posture score, action queue and programme health at a glance.',
    blocks: [
      { figure: img('06-dashboard'), caption: 'The dashboard: posture index, action queue, key numbers, framework coverage and the risk heat map.' },
      { h: 'The GRC Posture index' },
      { p: 'One score from 0 to 100 that summarises your programme. It is the weighted average of five measures, each shown as a bar so you can see what to improve:' },
      { table: { head: ['Measure', 'Weight', 'What raises it'], rows: [
        ['Policy quality', '25%', 'Fixing linter warnings in your policies'],
        ['Framework coverage', '25%', 'Mapping published policy statements to more controls'],
        ['Evidence freshness', '20%', 'Re-collecting evidence before it expires'],
        ['Risk within appetite', '20%', 'Treating risks until their residual score is within appetite'],
        ['Attestation', '10%', 'Getting everyone to acknowledge published policies'],
      ] } },
      { h: 'The action queue' },
      { figure: img('07-action-queue'), caption: 'Items are sorted by urgency. The coloured bar shows severity: red is critical, orange is high, yellow is medium.' },
      { p: 'Your personal to-do list: overdue policy reviews, approvals waiting for you, exceptions that are expiring or expired, stale evidence, and risks above appetite. Click any item to jump straight to it.' },
      { h: 'Make room: collapse the menu' },
      { list: [
        'Click the <b>collapse button</b> next to the MandateGRC logo (top of the menu), or press <b>[</b>, to shrink the menu to a slim icon rail. Hover an icon to see its name. Click the same button, now under the logo, or press <b>[</b> again to expand it.',
        'Click a section heading such as <b>RISK</b> or <b>COMPLY</b> (look for the small arrow) to fold that group. The page you are on stays visible even inside a folded group.',
        'MandateGRC remembers both choices on this browser.',
      ] },
    ],
  },

  // ===================================================================== Policies
  {
    id: 'write-policy', group: 'Policies', title: 'Write a policy, step by step', minutes: 8,
    summary: 'From a blank page (or template) to a lint-clean draft, one section at a time.',
    blocks: [
      { p: 'This is the core workflow in MandateGRC. Follow these steps for any policy: access control, acceptable use, incident response or your own.' },
      { figure: img('08-policies'), caption: 'The Policies page: every policy with its status, version, quality score, mapped frameworks, next review date and acknowledgement progress. Use the tabs to filter by status.' },
      { steps: [
        { t: 'Start a draft', d: 'Click <b>New policy</b> (on the dashboard or the Policies page) and choose <b>Blank policy</b>. Pick the <b>Policy type</b> (for example <i>Data classification</i>): it tells the review which must-have topics to check for, and the dialog lists them. Choose <b>Other / custom</b> if none fit. Adjust the suggested name, optionally add the owner, and click <b>Create draft</b>. A blank draft is genuinely empty: nothing is pre-filled except what you entered. You can change the type later under <b>Header</b> in the editor.', img: img('09-new-policy') },
        { t: 'Or start from a template', d: 'Prefer proven wording? In the same dialog choose <b>From a template</b> and pick the type, or open <b>Template Library</b> and click <b>Use template</b>. You get a copy of professionally written statements, already mapped to frameworks, which you then tailor. See <a href="#/docs/policy-library">Policy library</a> for what each one covers.', img: img('10-templates') },
        { t: 'Get to know the editor', d: 'The editor has three columns. <b>Left:</b> the anatomy, showing your score, grade and a status dot per section (red is blocking, yellow is a warning, green ✓ is done). Click a section to jump to it. <b>Middle:</b> the eight sections. <b>Right:</b> the live linter. Click any issue to jump to the exact place.', img: img('11-editor') },
        { t: '1 · Fill in the Header', d: 'Set the <b>Policy owner</b> (an accountable role such as "Chief Information Security Officer"), the <b>Classification</b>, the <b>Effective date</b> and the <b>Review cycle</b>; annual is the professional standard. <b>Version</b> and <b>Approval</b> are filled in automatically by the workflow, so you never type them.', img: img('12-header') },
        { t: '2 · Write the Purpose', d: 'One paragraph explaining <b>why</b> the policy exists, for example: "This policy establishes … in order to protect …". The counter under the box shows words and paragraphs.', img: img('13-purpose') },
        { t: '3 · Define the Scope', d: 'Say <b>who</b> it applies to (employees, contractors, third parties) and <b>what</b> (systems, data, devices, facilities). The linter warns if either is missing.', img: img('13b-scope') },
        { t: '4 · Write the Policy Statements', d: 'One rule per statement, numbered 4.1, 4.2… Use the pattern <b>[Who] must [do what] [by when / how often]</b>. Under each statement, the findings explain any problem. Add statements with <b>Add statement</b>, and reorder or delete them with the arrows and bin icons.', img: img('14-statements') },
        { t: 'Fix weak wording in one click', d: 'Whenever a statement uses a word that does not belong in a policy, the finding under it shows <b>Suggested</b> replacements. Each finding animates the change: the flagged words are struck through in red, the replacement slides in green, and the main suggestion pulses. Hover another suggestion to preview it. Click one to rewrite the statement in place. For example, "should" or "may" offers <b>Use "must"</b>, "regularly" offers <b>quarterly</b>, <b>monthly</b> or <b>every 90 days</b>, "promptly" offers <b>within 24 hours</b>, and escape clauses like "where possible" or "etc." offer <b>Remove it</b>. Suggestions follow the context: "appropriate encryption" offers <b>AES-256</b>. The same buttons appear in the <b>Policy linter</b> panel. Always check that the suggested value fits your organization.', img: img('16-fix-applied') },
        { t: 'Map each statement to controls', d: 'Click <b>Map controls</b> under a statement. MandateGRC reads the statement and suggests matching controls from ISO 27001, NIST CSF, NIST 800-53, CIS, SOC 2, PCI DSS, HIPAA and GDPR, plus equivalent controls for anything already mapped (the crosswalk). Tick the ones that apply and click <b>Apply mappings</b>.', img: img('17-map-controls') },
        { t: '5 · Assign Roles & Responsibilities', d: 'Every policy needs an Owner, a Custodian (who operates the controls), Users and Management. Click <b>Add missing standard roles</b> to insert any that are missing, then edit each responsibility so it is specific to this policy.', img: img('18-roles') },
        { t: '6 · Write Compliance & Enforcement', d: 'State how compliance is verified, what happens on violation, and how exceptions are requested. On an empty section, <b>Insert standard enforcement clause</b> gives you a professional starting point.', img: img('19-enforcement') },
        { t: '7 · Check the References', d: 'This section builds itself from your statement mappings and groups them by framework. Add policy-level references if needed, and list related standards or procedures in <b>Related documents</b>.', img: img('20-references') },
        { t: 'Watch the linter', d: 'The panel on the right lists every issue: <b>red</b> items block submission, <b>yellow</b> are warnings, <b>blue</b> are suggestions. When it shows <b>Ready for review</b>, the anatomy is complete.', img: img('15-linter') },
        { t: 'Check the Review report', d: 'Above the sections, the <b>Review report</b> checks substance as well as form: whether the policy covers every must-have topic for its type, whether its numbers meet published baselines, and whether it is consistent. Aim for the verdict <b>Ready</b>. See <a href="#/docs/policy-review">How MandateGRC reviews your policy</a>.', img: img('20b-review') },
        { t: 'Save', d: 'Click <b>Save changes</b> (top right) or press <b>⌘S / Ctrl+S</b>. If you try to leave with unsaved changes, MandateGRC asks first.', img: img('21-template-draft') },
      ] },
      { tip: 'Not sure how to phrase something? See <a href="#/docs/writing-guide">Policy writing guide</a> for word swaps and before/after examples for every section.' },
    ],
  },
  {
    id: 'writing-guide', group: 'Policies', title: 'Policy writing guide', minutes: 6,
    summary: 'Word swaps, examples and a pre-submission checklist used by experienced GRC analysts.',
    blocks: [
      { h: 'Replace weak words' },
      { table: { head: ['Instead of…', 'Write…', 'Why'], rows: [
        ['should, ought to', 'must / shall', 'Policies are mandatory; "should" is a recommendation'],
        ['try to, endeavour to, best effort', 'must + the required outcome', 'Effort cannot be audited; outcomes can'],
        ['regularly, periodically', 'every 90 days, quarterly, annually', 'A frequency can be tested'],
        ['promptly, timely, as soon as possible', 'within 24 hours, within 5 business days', 'A deadline can be tested'],
        ['adequate, appropriate, reasonable', 'AES-256, TLS 1.2+, 14 characters', 'Name the standard or threshold'],
        ['strong passwords / encryption', 'minimum 14 characters / AES-256', 'Define "strong"'],
        ['where possible, as needed', '(remove; use the exception process)', 'Escape clauses make rules unenforceable'],
        ['etc., and/or', 'list every item', 'Auditors test exactly what is written'],
      ] } },
      { h: 'Before and after' },
      { compare: [
        ['Employees should use the VPN when working remotely where possible.', 'Personnel must connect to organizational systems through the corporate VPN whenever working outside company premises.'],
        ['Staff will try to keep their laptops secure.', 'Laptops must have full-disk encryption enabled and must lock automatically after 5 minutes of inactivity.'],
        ['Security incidents must be reported promptly.', 'Suspected security incidents must be reported to the Security Operations Center within 1 hour of discovery.'],
        ['Access is reviewed regularly.', 'System owners must recertify privileged access every 90 days and all other access every 180 days.'],
      ] },
      { h: 'Section checklists' },
      { list: [
        '<b>Header:</b> named owner (a role, not a person who may leave), effective date, review cycle ≤ 12 months.',
        '<b>Purpose:</b> one paragraph, states the risk being reduced and the outcome.',
        '<b>Scope:</b> names people (employees, contractors, third parties) and assets (systems, data, devices).',
        '<b>Statements:</b> every statement has must/shall, one requirement each, a measurable criterion, and at least one control mapping.',
        '<b>Roles:</b> Owner, Custodian, Users and Management, each with a specific responsibility.',
        '<b>Enforcement:</b> how compliance is verified, the consequence of violation, and the exception route.',
        '<b>References:</b> at least one framework (ideally all the frameworks you report against).',
      ] },
      { tip: 'Aim for grade A (90+) before submitting. Warnings do not block submission, but approvers and auditors will notice them.' },
    ],
  },
  {
    id: 'policy-review', group: 'Policies', title: 'How MandateGRC reviews your policy', minutes: 6,
    summary: 'The Review report: coverage, benchmarks and consistency checks, and what each verdict means.',
    blocks: [
      { p: 'The linter checks that a policy is <b>well written</b>. The Review report goes further and checks that it is <b>good</b>: that it covers what a policy of its type must cover, that its numbers are strong enough, and that it does not contradict itself or your other policies. Every check is a published rule with a named source, so the result is the same every time and auditors can see exactly why.' },
      { tip: 'The review runs entirely in your browser and on your MandateGRC server. It uses no AI and sends your policy text nowhere.' },
      { figure: img('20b-review'), caption: 'The Review report on a partly written Access Control policy: the verdict, five scores, and each coverage gap with a ready-made statement.' },
      { h: 'The five scores' },
      { table: { head: ['Area', 'What is checked'], rows: [
        ['Structure', 'All 8 sections complete; owner, effective date and annual review set; every statement mapped to a framework control.'],
        ['Language', 'Every statement uses "must"/"shall"; no vague or non-mandatory wording ("should", "regularly", "where possible").'],
        ['Coverage', 'The must-have topics for the policy type, e.g. MFA, leavers and access reviews for Access Control. Shown as n/a for policy types without a checklist.'],
        ['Benchmarks', 'Numbers in your statements (password length, lockout attempts, patch deadlines, review intervals, breach notification…) compared with baselines from PCI DSS, NIST, ISO/IEC 27001, GDPR and CIS.'],
        ['Consistency', 'The owner appears in Roles; everyone given duties has a role; statements don\'t contradict each other; values agree with your other published policies.'],
      ] } },
      { h: 'Verdicts' },
      { table: { head: ['Verdict', 'Meaning', 'Can it be submitted?'], rows: [
        ['Ready', 'No blocking issues, no coverage gaps, benchmark failures or inconsistencies, and an overall score of 85+.', 'Yes'],
        ['Needs work', 'No blocking issues, but there are gaps, weak values or inconsistencies to consider.', 'Yes, but the approver must explicitly accept any coverage gaps.'],
        ['Not ready', 'Blocking issues remain, for example a missing section or fewer than half of the must-have topics covered.', 'No. The server refuses it.'],
      ] } },
      { h: 'Fix issues step by step' },
      { steps: [
        { t: 'Open the gaps', d: 'Expand <b>Coverage</b>. Each topic the policy misses is marked ✕ and shows a suggested statement written in "must/shall" language.' },
        { t: 'Insert a suggested statement', d: 'Click <b>Insert suggested statement</b>. It is added as the next numbered statement, already mapped to the framework controls it satisfies. Then edit the numbers to match your organization.', img: img('20d-inserted') },
        { t: 'Tighten weak values', d: 'Expand <b>Benchmarks</b> and <b>Consistency</b>. Each failed value names the baseline and its source, e.g. "Minimum password length: 8 characters, baseline 12 characters (PCI DSS v4.0 req. 8.3.6)". Either strengthen the value or record why in an approved <a href="#/docs/exceptions">exception</a>.', img: img('20c-review-benchmarks') },
        { t: 'Save and re-check', d: 'The report updates as you type. Save when the verdict reaches <b>Ready</b>, or <b>Needs work</b> with gaps you can justify.' },
      ] },
      { h: 'Policy types with checklists' },
      { list: [
        '<b>Access Control</b>: least privilege, unique accounts, MFA, passwords, lockout, access reviews, privileged access, leavers, session lock.',
        '<b>Acceptable Use</b>: authorized use, software, clear screen, data transfer, reporting, training, asset return.',
        '<b>Incident Response</b>: plan, reporting deadline, triage, escalation, regulatory notification, evidence, lessons learned, testing.',
        '<b>Data Classification &amp; Handling</b>: levels, labelling, encryption, storage, retention, disposal.',
        '<b>Backup &amp; Recovery</b>: frequency, RPO/RTO, off-site/immutable copy, encryption, restore testing, failure alerts.',
        '<b>Vulnerability &amp; Patch Management</b>: scanning, severity deadlines, known-exploited vulnerabilities, exceptions, penetration testing.',
        '<b>Third-Party Risk</b>: due diligence, tiering, contract terms, vendor breach notice, reassessment, offboarding.',
      ] },
      { p: 'The type is recognised from the policy name, so call it, for example, "Access Control Policy". For other policy types the review still checks structure, language, benchmarks and consistency.' },
      { warn: 'Baselines are widely used reference points, not legal advice. Your regulators, contracts or risk assessment may require stricter values. Where you deliberately choose a different value, record the decision in an exception so the reasoning is auditable.' },
    ],
  },
  {
    id: 'review-approve', group: 'Policies', title: 'Submit, review and approve', minutes: 4,
    summary: 'Draft → In review → Approved, with separation of duties built in.',
    blocks: [
      { p: 'The workflow bar at the top of every policy shows where it is: <b>Draft → In review → Approved → Published</b>. The buttons on the right change with the status and your role.' },
      { steps: [
        { t: 'Submit for review (author)', d: 'When the linter shows no blocking issues, click <b>Submit for review</b>. Choose <b>Minor</b> (wording, mappings) or <b>Major</b> (new or changed requirements). This sets the next version number. Then write a change summary, which becomes the revision-history entry. A first release is always v1.0.', img: img('22-submit') },
        { t: 'Find it in review (approver)', d: 'Approvers see the policy in their <b>Action queue</b> and in <b>Policies → In review</b>. The workflow bar shows who submitted it and their change summary.', img: img('23-in-review') },
        { t: 'Approve', d: 'Read the policy (the <b>Document view</b> is easiest to read; it ends with the Review report as an appendix), then click <b>Approve</b>. The dialog shows the review verdict and scores. An optional note is recorded in the audit trail. MandateGRC stamps the version number and saves a full snapshot in the revision history.', img: img('24-approve') },
        { t: 'Accept any coverage gaps explicitly', d: 'If the policy still misses must-have topics, the dialog lists them and <b>Approve</b> stays disabled until you tick <b>I have reviewed these gaps and accept them</b>. Your acceptance, with the list of gaps, is recorded in the audit trail. The server enforces this too.', img: img('24b-approve-gaps') },
        { t: '…or return it for rework', d: 'If changes are needed, click <b>Return for rework</b> and explain what to fix. The policy goes back to Draft and the author sees your note at the top of the editor and in their action queue.', img: img('25-return') },
      ] },
      { warn: 'You cannot approve a policy that you edited or submitted. The Approve button is disabled and the server rejects it. This is separation of duties, and auditors expect it.' },
    ],
  },
  {
    id: 'publish', group: 'Policies', title: 'Publish a policy', minutes: 2,
    summary: 'Put an approved policy in force and start collecting acknowledgements.',
    blocks: [
      { steps: [
        { t: 'Open the approved policy', d: 'Approved policies show <b>Publish</b>, <b>Revise</b> and <b>Retire</b> buttons in the workflow bar.', img: img('26-approved') },
        { t: 'Choose the effective date and publish', d: 'Click <b>Publish</b>, confirm the effective date, then click <b>Publish</b> again. MandateGRC calculates the next review date from the review cycle.', img: img('27-publish') },
        { t: 'Track acknowledgements', d: 'The policy is now in force. Everyone in the workspace is asked to acknowledge it, and the workflow bar shows how many have done so.', img: img('28-published') },
      ] },
      { tip: 'Published policies appear in every user\'s <b>Attestations</b> page. See <a href="#/docs/attestations">Acknowledge policies</a>.' },
    ],
  },
  {
    id: 'revise-retire', group: 'Policies', title: 'Revise, compare and retire', minutes: 4,
    summary: 'Keep policies current without losing the record of what was in force.',
    blocks: [
      { steps: [
        { t: 'Start a revision', d: 'On a published policy, click <b>Revise</b>. The policy becomes a draft you can edit, while the <b>published version stays in force</b> for employees until the revision is approved and published.' },
        { t: 'Read the revision history', d: 'Section 8 lists every approved version with date, change type, summary, author and approver. Click <b>View</b> to read exactly what a version said.', img: img('29-history') },
        { t: 'Compare versions', d: 'Click <b>Diff vs v…</b> to see what changed between two versions (or between the latest version and your working draft). Added lines are green; removed lines are red and struck through.', img: img('30-diff') },
        { t: 'Retire a policy', d: 'When a policy no longer applies, click <b>Retire</b> and give a reason. Retired policies are kept for the record but no longer count towards coverage or attestation. Never-approved drafts can be deleted instead.' },
      ] },
      { tip: 'Annual review counts as a revision even when nothing changes: revise, make a minor change (or confirm the wording), and submit with the summary "Annual review, no material changes".' },
    ],
  },
  {
    id: 'export', group: 'Policies', title: 'Export, print and share', minutes: 2,
    summary: 'A clean document view, PDF printing, Markdown and JSON exports.',
    blocks: [
      { steps: [
        { t: 'Open the document view', d: 'Click <b>Document view</b> on any policy to see it formatted as a professional policy document, with a header table, numbered statements, references and revision history.', img: img('32-document') },
        { t: 'Print or save as PDF', d: 'Click <b>Print / PDF</b>. The print layout removes the app chrome and uses a white page. Choose <b>Save as PDF</b> in your browser\'s print dialog.' },
        { t: 'Export Markdown or JSON', d: 'In the editor, click <b>Export</b> to download the policy as Markdown (for wikis and Git) or structured JSON (for other tools).', img: img('31-export') },
      ] },
    ],
  },
  {
    id: 'attestations', group: 'Policies', title: 'Acknowledge policies (attestation)', minutes: 2,
    summary: 'How everyone confirms they have read the policies in force.',
    blocks: [
      { steps: [
        { t: 'Open Attestations', d: 'The <b>Attestations</b> menu item shows a badge with the number of policies you still need to acknowledge.', img: img('33-attestations') },
        { t: 'Read and acknowledge', d: 'Click <b>Read &amp; acknowledge</b>, read the policy, then click <b>I have read and will comply</b> at the top. Your acknowledgement is recorded with the exact version you read.' },
        { t: 'Track completion (analysts and admins)', d: 'The <b>Organization completion</b> table shows the percentage per policy. Click the outstanding count to see who still needs to acknowledge.' },
      ] },
      { tip: 'When a new version is published, everyone must acknowledge it again. Acknowledgements always match the current text.' },
    ],
  },
  {
    id: 'policy-library', group: 'Policies', title: 'Policy library: what each template covers', minutes: 5,
    summary: 'The seven templates, who owns them, and what to tailor before you publish.',
    blocks: [
      { p: 'Each template follows the 8-part anatomy, passes the linter and is mapped across frameworks. Before submitting, always tailor the items listed under <b>Tailor</b> to your organization.' },
      { templates: [
        { name: 'Access Control Policy', owner: 'CISO', covers: 'Least privilege, unique accounts, MFA, password length, lockout, access recertification, leaver revocation, session lock.', tailor: 'MFA scope, password length, review frequencies (90/180 days), leaver deadlines.', fw: 'ISO 27001 5.15–5.18, 8.2, 8.5 · NIST AC/IA · SOC 2 CC6 · CIS 5–6 · PCI DSS 7–8' },
        { name: 'Acceptable Use Policy', owner: 'CISO', covers: 'Business use of assets, approved software, clear screen, data transfer limits, incident reporting, training, asset return.', tailor: 'Personal-use allowance, approved software process, reporting channel, training deadline.', fw: 'ISO 27001 5.10, 5.14, 6.3, 6.8, 7.7, 8.19 · NIST PL-4, AT-2' },
        { name: 'Incident Response Policy', owner: 'Head of Security Operations', covers: 'IR plan, 1-hour reporting, severity triage, SEV1 escalation, breach notification (72h), evidence handling, post-incident review, tabletop exercises.', tailor: 'Severity definitions, escalation contacts, regulatory notification duties.', fw: 'ISO 27001 5.24–5.28 · NIST CSF RS · NIST IR-4/6/8 · GDPR Art. 33–34' },
        { name: 'Data Classification & Handling Policy', owner: 'Chief Data Officer', covers: 'Four classification levels, labelling, encryption at rest and in transit, removable media, retention, secure disposal.', tailor: 'Level names, encryption standards, retention schedule reference.', fw: 'ISO 27001 5.12–5.13, 8.10–8.12, 8.24 · NIST SC-8/13/28, MP-6 · SOC 2 C1' },
        { name: 'Backup & Recovery Policy', owner: 'Head of IT Infrastructure', covers: 'Backup frequency and RPO, immutable off-site copies, backup encryption, restore testing, failure alerting.', tailor: 'Tier definitions, RPO/RTO targets, restore-test cadence.', fw: 'ISO 27001 8.13, 5.30 · NIST CP-2, CP-9 · CIS 11 · SOC 2 A1.2' },
        { name: 'Vulnerability & Patch Management Policy', owner: 'CISO', covers: 'Scan frequency, remediation SLAs by severity, KEV handling, exceptions for missed SLAs, annual penetration testing.', tailor: 'SLA days per severity, scanning tools and scope.', fw: 'ISO 27001 8.8, 8.29 · NIST RA-5, SI-2 · CIS 7, 18 · PCI DSS 6, 11' },
        { name: 'Third-Party Risk Management Policy', owner: 'Head of Procurement & Vendor Risk', covers: 'Pre-contract due diligence, vendor tiering, contract security clauses, reassessment cadence, access revocation.', tailor: 'Tier criteria, breach-notification window, reassessment cycle.', fw: 'ISO 27001 5.19–5.22 · NIST CSF GV.SC · SOC 2 CC9.2 · GDPR Art. 28' },
      ] },
    ],
  },

  // ===================================================================== Risk & compliance
  {
    id: 'risks', group: 'Risk & compliance', title: 'Manage risks', minutes: 5,
    summary: 'Score, treat and track risks against your appetite.',
    blocks: [
      { figure: img('34-risks'), caption: 'Inherent risk (before controls) and residual risk (after controls) heat maps. Dashed cells are within your risk appetite.' },
      { steps: [
        { t: 'Add a risk', d: 'Go to <b>Risk Register</b> and click <b>New risk</b>. Write the title as <i>event + cause + consequence</i>, for example "Ransomware encrypts production file servers". Then set the owner and category.', img: img('35-risk-form') },
        { t: 'Score it twice', d: 'Rate <b>inherent</b> likelihood and impact (1–5, before controls), then <b>residual</b> (after controls). The score is likelihood × impact. MandateGRC shows the level and whether the risk is within appetite.' },
        { t: 'Choose a treatment', d: '<b>Mitigate</b> (add controls), <b>Transfer</b> (insurance, contracts), <b>Avoid</b> (stop the activity) or <b>Accept</b>. Write the treatment plan and a due date.' },
        { t: 'Quantify (optional)', d: 'Enter the <b>single loss expectancy</b> (cost of one occurrence) and the <b>annual rate of occurrence</b>. MandateGRC calculates the <b>annualized loss expectancy</b> (ALE = SLE × ARO) and totals it on the dashboard.' },
        { t: 'Link policies and controls', d: 'Select the policies that govern the risk and use <b>Link controls</b> to choose the mitigating controls. Controls show these links in their detail view.' },
        { t: 'Filter the heat map', d: 'Click any cell of the residual heat map to list only the risks in that cell.' },
      ] },
      { table: { head: ['Score', 'Level'], rows: [['1–5', 'Low'], ['6–11', 'Medium'], ['12–19', 'High'], ['20–25', 'Critical']] } },
      { tip: 'Set your risk appetite in <a href="#/docs/settings">Settings</a>. Any open risk whose residual score is above it appears in everyone\'s action queue.' },
    ],
  },
  {
    id: 'exceptions', group: 'Risk & compliance', title: 'Request and decide exceptions', minutes: 3,
    summary: 'Time-boxed, approved deviations from a specific policy statement.',
    blocks: [
      { figure: img('36-exceptions'), caption: 'Open exceptions with their risk rating, status and expiry countdown.' },
      { steps: [
        { t: 'Request an exception', d: 'Click <b>Request exception</b>. Choose the <b>policy</b> and the exact <b>statement</b> you cannot meet, explain the business justification, and describe the <b>compensating controls</b> that reduce the risk in the meantime.', img: img('37-exception-request') },
        { t: 'Rate and time-box it', d: 'Set likelihood and impact, and an expiry date no more than <b>365 days</b> away. A permanent deviation requires a policy change, not an exception.' },
        { t: 'Decide (approver)', d: 'Open the exception and click <b>Approve exception</b> or <b>Reject</b> (rejections need a note). Exceptions without compensating controls cannot be approved, and you cannot decide your own request.' },
        { t: 'Close it', d: 'When the gap is remediated, click <b>Close</b>. Approved exceptions past their expiry date automatically show as <b>Expired</b> and appear in the action queue.' },
      ] },
    ],
  },
  {
    id: 'frameworks', group: 'Risk & compliance', title: 'Frameworks, controls & coverage', minutes: 4,
    summary: 'See exactly which policy statements cover each control, and where the gaps are.',
    blocks: [
      { figure: img('38-frameworks'), caption: 'Each card shows coverage by published policies (gold) and drafts (faint). Below, every control has a coverage dot: green means published, yellow means draft only, grey means gap.' },
      { steps: [
        { t: 'Pick a framework', d: 'Click a framework card. Use the <b>Gaps</b> filter to list controls no policy addresses yet. These are your next policy statements.' },
        { t: 'Open a control', d: 'Click a control to see the exact policy statements that satisfy it, its evidence, the risks it mitigates, and the <b>crosswalk</b>: equivalent controls in other frameworks.', img: img('39-control') },
        { t: 'Add your own framework', d: 'Click <b>Custom framework</b> to add regulations or customer requirements that aren\'t built in (for example NIS2, DORA or CMMC). Then use <b>Add / import controls</b> to paste them as CSV.', img: img('40-custom-framework') },
      ] },
      { h: 'CSV import format' },
      { code: 'ref,title,family,themes\nArt.21(2)(a),Policies on risk analysis and information system security,Risk-management measures,risk;gov\nArt.21(2)(b),Incident handling,Risk-management measures,incident' },
      { p: 'Themes are optional and separated by semicolons. They power crosswalk suggestions. Available themes include: access, crypto, logging, vuln, incident, backup, continuity, supplier, training, hr, physical, asset, data, change, sdlc, network, malware, endpoint, privacy, gov, config, risk and legal.' },
    ],
  },
  {
    id: 'evidence', group: 'Risk & compliance', title: 'Collect evidence', minutes: 3,
    summary: 'Prove controls operate, and keep the proof fresh.',
    blocks: [
      { figure: img('41-evidence'), caption: 'Evidence with its control, collection date, validity window and status (Fresh, Due soon, Stale).' },
      { steps: [
        { t: 'Add evidence', d: 'Click <b>Add evidence</b>, choose the framework and control, and give it a title and description of what it shows.', img: img('42-evidence-form') },
        { t: 'Point to where it lives', d: 'In <b>Location</b>, paste an https link or a reference such as a ticket ID or repository path. MandateGRC stores references, not files, so sensitive artefacts stay in your systems of record.' },
        { t: 'Set how long it stays valid', d: 'Choose <b>Valid for</b>: weekly, monthly, quarterly, 6 months or annually. Evidence turns <b>Due soon</b> 14 days before expiry and <b>Stale</b> after it; stale items appear in the action queue.' },
      ] },
    ],
  },

  // ===================================================================== Assurance & admin
  {
    id: 'audit', group: 'Assurance & admin', title: 'Audit trail', minutes: 2,
    summary: 'A tamper-evident record of every action, verifiable in one click.',
    blocks: [
      { figure: img('43-audit'), caption: 'Every action, who did it and when, each entry chained to the previous one with SHA-256.' },
      { steps: [
        { t: 'Search', d: 'Filter by user, action (for example <i>policy.approved</i>) or entity.' },
        { t: 'Verify integrity', d: 'Click <b>Verify integrity</b>. MandateGRC recomputes the hash chain. "Chain intact" proves no entry was altered or removed.' },
        { t: 'Export for auditors', d: 'Click <b>Export CSV</b> to download the full trail, including the hashes, so auditors can verify it independently.' },
      ] },
    ],
  },
  {
    id: 'team', group: 'Assurance & admin', title: 'Invite your team', minutes: 3,
    summary: 'Add colleagues with the right role. No passwords to hand out.',
    blocks: [
      { figure: img('44-users'), caption: 'Users & roles: everyone in your workspace, their role, status, passkeys and last sign-in.' },
      { steps: [
        { t: 'Create an invite', d: 'Go to <b>Users &amp; Roles</b> and click <b>Invite someone</b>. Choose the role and how long the invite is valid (1–14 days).', img: img('45-invite') },
        { t: 'Share the link', d: 'Copy the invite <b>link</b> (or the code) and send it through a channel you trust. It works once and is shown only now, because MandateGRC stores only a hash of it.', img: img('46-invite-code') },
        { t: 'They join', d: 'Your colleague opens the link, chooses a username and creates their own passkey. They appear in your user list with the role you chose.' },
        { t: 'Change roles or deactivate', d: 'Click <b>Edit</b> on any user to change their display name or role, or untick <b>Account active</b> to remove access immediately (their sessions end at once).' },
      ] },
      { h: 'Someone lost their device' },
      { steps: [
        { t: 'Issue a recovery code', d: 'Click <b>Recovery code</b> next to the person. Tick <b>revoke all of their existing passkeys</b> if the device may have been stolen.', img: img('47-recovery') },
        { t: 'They create a new passkey', d: 'They open the link (or enter the code under <b>Get started → Enter an invite or recovery code</b>) and create a passkey on their new device. The code is valid for 24 hours and works once.' },
      ] },
    ],
  },
  {
    id: 'account', group: 'Assurance & admin', title: 'Your account & passkeys', minutes: 2,
    summary: 'Add a backup passkey and manage your devices.',
    blocks: [
      { steps: [
        { t: 'Open My account', d: 'Click the key icon next to your name at the bottom of the sidebar.', img: img('48-account') },
        { t: 'Add a backup passkey', d: 'Click <b>Add a passkey</b> and approve on the device you want to add, such as your phone or a hardware security key. Keeping two passkeys means losing one device never locks you out.' },
        { t: 'Remove an old device', d: 'Click <b>Remove</b> next to a passkey you no longer use. You always need at least one.' },
      ] },
    ],
  },
  {
    id: 'settings', group: 'Assurance & admin', title: 'Workspace settings', minutes: 1,
    summary: 'Organization name, risk appetite and session timeout.',
    blocks: [
      { figure: img('49-settings'), caption: 'Settings are available to administrators. Every change is recorded in the audit trail.' },
      { list: [
        '<b>Organization name</b>: shown across the app and on policy documents.',
        '<b>Risk appetite</b>: the maximum acceptable residual score (1–25). Risks above it are flagged. 9 means "nothing above Medium".',
        '<b>Session idle timeout</b>: minutes of inactivity before users are signed out (5–240).',
        '<b>Sample data</b>: if you created the workspace with sample data, the example items are marked <b>Sample</b>. Click <b>Remove sample data</b> (here, or in the banner on the dashboard and Policies page) to delete them all at once. Your own work is never touched.',
      ] },
    ],
  },

  // ===================================================================== Help
  {
    id: 'troubleshooting', group: 'Help', title: 'Troubleshooting & FAQ', minutes: 4,
    summary: 'Answers to the questions people ask most.',
    blocks: [
      { faq: [
        ['"The passkey request was cancelled or timed out"', 'Click the button again and approve the prompt within two minutes. In Safari, make sure you click the button itself (not press Enter in another field). If you have no Touch ID, choose "Use phone or tablet" or a security key in the browser prompt.'],
        ['"Passkeys don\'t work on IP addresses"', 'Open MandateGRC by its name (mandategrc.app, or http://localhost when running it yourself), never by an IP address such as 127.0.0.1.'],
        ['I lost my phone or laptop', 'Sign in with your backup passkey if you added one. Otherwise ask your administrator for a recovery code (see <a href="#/docs/team">Invite your team</a>).'],
        ['Why can\'t I approve this policy?', 'You edited or submitted it. Separation of duties requires a different approver.'],
        ['Why is "Submit for review" rejected?', 'The linter still shows blocking (red) issues. Click each one in the linter panel to jump to it and fix it.'],
        ['Can an exception last longer than a year?', 'No. Exceptions expire within 365 days. A permanent deviation needs a policy change.'],
        ['Can people from other organizations see my data?', 'No. Every record belongs to your workspace and every request is limited to it. Others can only join through an invite your administrator creates.'],
        ['What does MandateGRC store about me?', 'Your username, optional display name, the public key of your passkeys, and the work you do in your workspace. No email, password, phone number or IP address. See the <a href="#/privacy">privacy policy</a>.'],
      ] },
    ],
  },
  {
    id: 'glossary', group: 'Help', title: 'Glossary', minutes: 3,
    summary: 'GRC terms used throughout MandateGRC.',
    blocks: [
      { table: { head: ['Term', 'Meaning'], rows: [
        ['Attestation', 'A person\'s recorded acknowledgement that they have read a specific policy version.'],
        ['ALE / SLE / ARO', 'Annualized loss expectancy = single loss expectancy × annual rate of occurrence.'],
        ['Compensating control', 'A safeguard that reduces risk while a policy requirement cannot be met.'],
        ['Control', 'A requirement in a framework, e.g. ISO 27001 8.5 "Secure authentication".'],
        ['Crosswalk', 'Equivalent controls across frameworks, so one statement can satisfy several.'],
        ['Inherent / residual risk', 'Risk before controls / risk remaining after controls.'],
        ['Passkey', 'A phishing-resistant sign-in credential (FIDO2/WebAuthn) unlocked by your device\'s biometric or PIN.'],
        ['Risk appetite', 'The level of residual risk the organization is willing to accept.'],
        ['Separation of duties', 'No single person both makes and approves a change.'],
        ['Statement', 'One numbered, mandatory rule in a policy (section 4).'],
      ] } },
    ],
  },
];
