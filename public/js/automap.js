// Automatic control mapping. Runs entirely in the browser: no AI, nothing leaves the page.
// 1. A curated concept table recognises what a statement is about ("incident response plan",
//    "multi-factor authentication", "log retention") and names the controls an auditor would expect.
// 2. For anything the table does not know (and for custom frameworks) a fallback ranks controls by
//    shared themes plus rare words shared with the control title.
// Suggestions are never treated as mapped: the analyst verifies each one.
import { suggestThemes } from './lint.js';

// [id, label, pattern, refs, context?]. The optional context pattern must also appear in the statement. A ref is 'FRAMEWORK ref'; a leading '~' marks a secondary (weaker) match.
const C = [
  // ---------------- Incident response
  ['ir-plan', 'incident response plan', /incident response (plan|procedure|process|program)|response procedures|\birp\b|incident management (plan|process)/,
    ['ISO27001 5.24', 'NISTCSF RS.MA', 'NIST80053 IR-8', '~NIST80053 IR-1', 'CIS 17', 'SOC2 CC7.4', 'PCIDSS 12', 'HIPAA 164.308(a)(6)']],
  ['ir-triage', 'triage and classify incidents', /triag|severity|classif\w* (the |each |all )?(incident|event|alert)|(incident|event)s? (shall|must)? ?be classified|assess\w* (security )?events?|true (security )?incident|prioriti[sz]\w* (incident|alert)/,
    ['ISO27001 5.25', 'NISTCSF RS.AN', '~NISTCSF DE.AE', 'NIST80053 IR-4', 'SOC2 CC7.3', 'CIS 17']],
  ['ir-respond', 'contain and respond to incidents', /containment|contain (the|an?|affected|compromised)|eradicat|respond\w* to (a |an |all |each )?(security )?incident|incident handling|handl\w* (of )?incidents?|isolat\w* (affected|compromised)/,
    ['ISO27001 5.26', 'NISTCSF RS.MI', '~NISTCSF RS.MA', 'NIST80053 IR-4', 'SOC2 CC7.4', 'CIS 17', 'HIPAA 164.308(a)(6)']],
  ['ir-report', 'report security events', /report\w* (any |all |a )?(suspected|actual|observed|security|potential)|(must|shall) (immediately |promptly )?report|reporting (channel|mechanism|line)|(events?|incidents?|weakness\w*) (must|shall) be reported/,
    ['ISO27001 6.8', 'NIST80053 IR-6', 'NISTCSF RS.CO', 'SOC2 CC2.2', 'HIPAA 164.308(a)(6)', '~CIS 17']],
  ['ir-notify-auth', 'notify regulators of breaches', /notif\w* .{0,40}(authorit|regulator|supervisory|law enforcement)|(authorit|regulator|supervisory)\w* .{0,30}notif|72 hours/,
    ['GDPR Art. 33', 'ISO27001 5.5', 'NISTCSF RS.CO', 'NIST80053 IR-6', 'SOC2 CC2.3']],
  ['ir-notify-people', 'notify affected people', /notif\w* .{0,40}(customer|data subject|affected (individual|person|part|user)|client)/,
    ['GDPR Art. 34', 'NISTCSF RS.CO', 'SOC2 CC2.3', '~NISTCSF RC.CO']],
  ['ir-comms', 'incident communication', /out-of-band|contact (list|information|detail)s?|escalation (path|matrix|procedure)s?|communicat\w*|stakeholders?|escalat\w*/,
    ['NISTCSF RS.CO', '~ISO27001 5.24', 'SOC2 CC2.3', '~NIST80053 IR-8', '~CIS 17'], /incident|breach|crisis|emergency|response|out-of-band/],
  ['ir-lessons', 'lessons learned', /lessons learn|post-incident|post-mortem|postmortem|root cause|after-action/,
    ['ISO27001 5.27', 'NISTCSF ID.IM', '~NIST80053 IR-4', '~SOC2 CC7.5', '~CIS 17']],
  ['ir-evidence', 'evidence and forensics', /evidence|forensic|chain of custody/,
    ['ISO27001 5.28', 'NISTCSF RS.AN', '~NIST80053 IR-4']],
  ['ir-exercise', 'test the response plan', /tabletop|(response|incident) (plan )?(exercise|drill|test)|(exercise|test)\w* (the )?(incident )?response/,
    ['ISO27001 5.24', 'NIST80053 IR-8', 'NISTCSF ID.IM', 'CIS 17', '~SOC2 CC7.4']],
  ['ir-recover', 'recover after an incident', /recover\w* from|restor\w* (normal )?(operations|services)|return to normal|recovery (plan|activities)/,
    ['NISTCSF RC.RP', 'SOC2 CC7.5', '~ISO27001 5.29', '~NIST80053 CP-2']],
  ['ir-team', 'incident response team', /incident response team|\bcsirt\b|\bcirt\b|incident (manager|commander|coordinator)/,
    ['ISO27001 5.24', 'NIST80053 IR-8', 'NISTCSF RS.MA', '~SOC2 CC7.4', '~CIS 17']],

  // ---------------- Logging and monitoring
  ['log-enable', 'event logging', /\blog(s|ging)?\b.{0,40}(enabl|collect|captur|generat|record)|(enabl|collect|captur|generat|record)\w* .{0,30}\blogs?\b|event logging|audit (log|trail)/,
    ['ISO27001 8.15', 'NIST80053 AU-2', 'CIS 8', 'SOC2 CC7.2', 'PCIDSS 10', 'HIPAA 164.312(b)', '~NISTCSF DE.CM']],
  ['log-protect', 'protect and retain logs', /\blogs?\b.{0,60}(retain|retention|tamper|protect|integrity|immutable)|(retain|protect)\w* .{0,30}\blogs?\b/,
    ['ISO27001 8.15', 'NIST80053 AU-9', 'CIS 8', 'PCIDSS 10', '~HIPAA 164.312(b)']],
  ['log-review', 'review logs', /\blogs?\b.{0,30}(review|analy[sz])|(review|analy[sz])\w* .{0,30}\blogs?\b/,
    ['NIST80053 AU-6', 'ISO27001 8.16', 'CIS 8', 'NISTCSF DE.AE', 'PCIDSS 10']],
  ['monitor', 'security monitoring and detection', /\bsiem\b|monitor\w*|detect\w*|alert\w* on|security operations|\bsoc\b(?! 2)|anomal/,
    ['ISO27001 8.16', 'NIST80053 SI-4', 'NISTCSF DE.CM', 'SOC2 CC7.2', 'CIS 13', '~NIST80053 CA-7']],
  ['clock', 'clock synchronisation', /clock|time synchron|\bntp\b|time source/,
    ['ISO27001 8.17', '~NIST80053 AU-2']],

  // ---------------- Malware and endpoints
  ['malware', 'malware protection', /malware|anti-?virus|endpoint detection|\bedr\b|\bxdr\b|ransomware|malicious (code|software)/,
    ['ISO27001 8.7', 'NIST80053 SI-3', 'CIS 10', 'SOC2 CC6.8', 'PCIDSS 5', '~NISTCSF DE.CM']],
  ['endpoint', 'endpoint devices', /laptop|workstation|endpoint device|mobile device|\bbyod\b|company[- ]issued device|user device/,
    ['ISO27001 8.1', 'HIPAA 164.310(c)', 'CIS 4', '~HIPAA 164.310(b)']],
  ['screen-lock', 'screen and session lock', /screen ?lock|session lock|lock (the|their) screen|inactiv|idle|auto-?lock|clear screen|unattended/,
    ['NIST80053 AC-11', 'ISO27001 7.7', '~ISO27001 8.1', '~CIS 4']],
  ['removable', 'removable media', /removable (media|storage)|\busb\b|storage media|external (drive|storage)/,
    ['ISO27001 7.10', 'HIPAA 164.310(d)(1)', '~NIST80053 MP-1', '~CIS 3']],

  // ---------------- Identity and access
  ['acc-policy', 'access control rules', /access control (policy|rules|procedure)|role-based access|\brbac\b|access (is|shall be|must be) (granted|restricted) based/,
    ['ISO27001 5.15', 'NIST80053 AC-1', 'NIST80053 AC-3', 'NISTCSF PR.AA', 'SOC2 CC6.1', 'HIPAA 164.312(a)(1)']],
  ['least-priv', 'least privilege', /least privilege|need[- ]to[- ]know|minimum (necessary|access|required)|only the access/,
    ['NIST80053 AC-6', 'ISO27001 8.3', 'PCIDSS 7', 'SOC2 CC6.3', '~ISO27001 5.15', '~HIPAA 164.308(a)(4)']],
  ['acc-grant', 'request and approve access', /(provision|request|grant|approv|authori[sz])\w* .{0,40}(access|account)|(access|account)s? .{0,30}(approv|authori[sz])|new (user|account|joiner)/,
    ['ISO27001 5.18', 'NIST80053 AC-2', 'CIS 6', 'SOC2 CC6.2', 'HIPAA 164.308(a)(4)', '~NISTCSF PR.AA']],
  ['acc-revoke', 'remove access on leaving', /(revok|remov|disabl|deprovision|deactivat|withdraw)\w* .{0,40}(access|account|credential)|leaver|departure|change (of|in) (role|employment)/,
    ['ISO27001 5.18', 'ISO27001 6.5', 'NIST80053 PS-4', 'SOC2 CC6.3', 'CIS 6', '~NIST80053 AC-2']],
  ['acc-review', 'periodic access reviews', /access review|recertif|(review|re-?validat)\w* .{0,40}(access|privilege|entitlement|permission)s?|user access audit/,
    ['ISO27001 5.18', 'NIST80053 AC-2', 'SOC2 CC6.3', 'CIS 6', '~PCIDSS 7']],
  ['unique-id', 'unique user accounts', /unique|individually attributable|shared (account|credential|login|id)|generic account|one account per/,
    ['ISO27001 5.16', 'NIST80053 IA-2', 'PCIDSS 8', 'CIS 5', 'HIPAA 164.312(a)(1)', '~NIST80053 AC-2']],
  ['mfa', 'multi-factor authentication', /multi-?factor|\bmfa\b|two-?factor|\b2fa\b|second factor|strong authentication|phishing-resistant|passkey|single sign-on|\bsso\b|authenticat/,
    ['ISO27001 8.5', 'NIST80053 IA-2', 'NISTCSF PR.AA', 'CIS 6', 'PCIDSS 8', 'SOC2 CC6.1', 'HIPAA 164.312(d)']],
  ['password', 'passwords and secrets', /password|passphrase|credential|secret|\bpin\b|authenticator/,
    ['ISO27001 5.17', 'NIST80053 IA-5', 'PCIDSS 8', 'CIS 5', '~HIPAA 164.312(d)']],
  ['privileged', 'privileged access', /privileged|admin(istrator|istrative)? (access|account|right|privilege)|root (access|account)|superuser|elevated/,
    ['ISO27001 8.2', 'NIST80053 AC-6', 'CIS 5', 'PCIDSS 7', '~ISO27001 8.18', '~SOC2 CC6.1']],
  ['lockout', 'failed log-in lockout', /lock(ed)? ?out|unsuccessful (log|attempt)|failed (log|login|sign|attempt)|consecutive (failed|invalid)/,
    ['NIST80053 AC-7', 'ISO27001 8.5', '~PCIDSS 8']],
  ['remote', 'remote access', /remote (access|work|connection)|\bvpn\b|work(ing)? from home|teleworking/,
    ['NIST80053 AC-17', 'ISO27001 6.7', '~NISTCSF PR.AA', '~CIS 12']],
  ['sod', 'segregation of duties', /segregation of duties|separation of duties|conflicting duties|two-person/,
    ['ISO27001 5.3', '~SOC2 CC5.1']],
  ['source-code', 'access to source code', /source code|code repositor/,
    ['ISO27001 8.4', '~CIS 16']],

  // ---------------- Cryptography
  ['enc-rest', 'encryption at rest', /at rest|encrypt\w* .{0,40}(stored|disk|database|laptop|device|storage|backup)|full[- ]disk encryption/,
    ['ISO27001 8.24', 'NIST80053 SC-28', 'CIS 3', 'PCIDSS 3', 'NISTCSF PR.DS', '~GDPR Art. 32']],
  ['enc-transit', 'encryption in transit', /in transit|transmi(t|ssion)|\btls\b|\bhttps\b|\bssl\b|over (public|untrusted) networks/,
    ['ISO27001 8.24', 'NIST80053 SC-8', 'PCIDSS 4', 'HIPAA 164.312(e)(1)', 'SOC2 CC6.7', '~ISO27001 5.14']],
  ['keys', 'cryptographic key management', /key management|cryptographic key|encryption key|key rotation|\bhsm\b|certificate|\bkms\b/,
    ['ISO27001 8.24', 'NIST80053 SC-13', '~SOC2 CC6.1', '~PCIDSS 3']],
  ['crypto-gen', 'use of cryptography', /encrypt|cryptograph|\baes\b|cipher/,
    ['ISO27001 8.24', 'NIST80053 SC-13', '~NISTCSF PR.DS']],

  // ---------------- Vulnerabilities and configuration
  ['vuln-scan', 'vulnerability scanning', /vulnerabilit\w* (scan|assessment)|scan\w*|vulnerability management|\bcvss\b|\bcve\b/,
    ['ISO27001 8.8', 'NIST80053 RA-5', 'CIS 7', 'PCIDSS 11', 'SOC2 CC7.1', 'NISTCSF ID.RA']],
  ['patch', 'patching and remediation', /patch|remediat|flaw|security update|end[- ]of[- ](life|support)|unsupported (software|system)/,
    ['ISO27001 8.8', 'NIST80053 SI-2', 'CIS 7', 'PCIDSS 6', '~SOC2 CC7.1']],
  ['pentest', 'penetration testing', /penetration test|pen[- ]?test|red team/,
    ['CIS 18', 'PCIDSS 11', 'ISO27001 8.29', 'NIST80053 SA-11', '~ISO27001 8.8']],
  ['threat-intel', 'threat intelligence', /threat intel|threat feed|advisor(y|ies)/,
    ['ISO27001 5.7', '~NISTCSF ID.RA']],
  ['baseline', 'secure configuration', /baseline|harden|secure configuration|cis benchmark|default (password|credential|setting|account)|configuration (standard|management)/,
    ['ISO27001 8.9', 'NIST80053 CM-2', 'CIS 4', 'PCIDSS 2', 'NISTCSF PR.PS', '~NIST80053 CM-1', '~SOC2 CC5.2']],
  ['sw-install', 'software installation', /install\w* .{0,30}software|unapproved software|unauthori[sz]ed software|software (allow|white)list|application (allow|white)list/,
    ['ISO27001 8.19', 'CIS 2', '~NIST80053 CM-2']],
  ['change', 'change management', /change (management|request|control|advisory)|changes? .{0,30}(approv|test|document|review)|\bcab\b|release management|rollback/,
    ['ISO27001 8.32', 'NIST80053 CM-3', 'SOC2 CC8.1', 'PCIDSS 6', '~SOC2 CC3.4']],
  ['env-sep', 'separate environments', /(separat|segregat|isolat)\w* .{0,40}(production|environment)|non-production|test environment|staging/,
    ['ISO27001 8.31', '~PCIDSS 6']],

  // ---------------- Development
  ['sdlc', 'secure development', /secure (coding|development)|code review|\bsdlc\b|development life ?cycle|\bowasp\b|security requirements/,
    ['ISO27001 8.25', 'ISO27001 8.28', 'NIST80053 SA-8', 'CIS 16', 'PCIDSS 6', '~ISO27001 8.26']],
  ['sec-test', 'security testing in development', /\bsast\b|\bdast\b|security test|static analysis|dependency scan|software composition/,
    ['ISO27001 8.29', 'NIST80053 SA-11', 'CIS 16', '~PCIDSS 6']],
  ['test-data', 'test data', /test data|production data .{0,30}test|anonymi[sz]|pseudonymi[sz]|data masking/,
    ['ISO27001 8.33', 'ISO27001 8.11', '~GDPR Art. 25']],
  ['outsourced-dev', 'outsourced development', /outsourced development|third[- ]party developer|contract(ed)? developer/,
    ['ISO27001 8.30', '~CIS 16']],

  // ---------------- Network
  ['firewall', 'network security controls', /firewall|network security|perimeter|boundary|ingress|egress|inbound|outbound/,
    ['ISO27001 8.20', 'NIST80053 SC-7', 'CIS 12', 'PCIDSS 1', 'SOC2 CC6.6', '~NISTCSF PR.IR']],
  ['segmentation', 'network segmentation', /segment|segregat\w* .{0,20}network|\bvlan\b|\bdmz\b|micro-?segment/,
    ['ISO27001 8.22', 'NIST80053 SC-7', 'PCIDSS 1', '~CIS 12']],
  ['wireless', 'wireless networks', /wi-?fi|wireless|guest network/,
    ['ISO27001 8.20', 'CIS 12', '~ISO27001 8.21']],
  ['web-email', 'email and web filtering', /web filter|url filter|email (filter|security|gateway)|spam|dmarc|spf\b|dkim/,
    ['ISO27001 8.23', 'CIS 9', '~SOC2 CC6.8']],

  // ---------------- Backup and continuity
  ['backup', 'backups', /backup|back(ed)? up/,
    ['ISO27001 8.13', 'NIST80053 CP-9', 'CIS 11', 'SOC2 A1.2', 'HIPAA 164.308(a)(7)', '~NISTCSF PR.DS']],
  ['restore', 'restore testing', /restor/,
    ['ISO27001 8.13', 'NIST80053 CP-9', 'CIS 11', 'NISTCSF RC.RP', '~SOC2 A1.2']],
  ['bcp', 'business continuity and disaster recovery', /business continuity|disaster recovery|continuity plan|contingency|\brto\b|\brpo\b|recovery time|recovery point|\bbcp\b|\bdrp?\b/,
    ['ISO27001 5.29', 'ISO27001 5.30', 'NIST80053 CP-2', 'SOC2 CC9.1', 'SOC2 A1.2', 'NISTCSF RC.RP', 'HIPAA 164.308(a)(7)']],
  ['redundancy', 'redundancy and capacity', /redundan|failover|high availability|capacity|single point of failure/,
    ['ISO27001 8.14', 'ISO27001 8.6', 'NISTCSF PR.IR', '~SOC2 A1.2']],

  // ---------------- Third parties
  ['vendor', 'supplier security', /vendor|supplier|third[- ]part|service provider|subprocessor|sub-processor|outsourc/,
    ['ISO27001 5.19', 'NISTCSF GV.SC', 'NIST80053 SR-3', 'CIS 15', 'SOC2 CC9.2', '~PCIDSS 12']],
  ['vendor-contract', 'security terms in supplier contracts', /contracts?|agreements?|clauses?|terms|\bdpa\b|\bbaa\b/,
    ['ISO27001 5.20', 'GDPR Art. 28', 'HIPAA 164.308(b)(1)', '~SOC2 CC9.2', '~NIST80053 SR-3'], /vendor|supplier|third[- ]part|processor|business associate|provider/],
  ['vendor-review', 'monitor suppliers', /review\w*|monitor\w*|re-?assess\w*|annual\w*|tier\w*|due diligence|questionnaires?/,
    ['ISO27001 5.22', 'SOC2 CC9.2', 'NISTCSF GV.SC', 'CIS 15'], /vendor|supplier|third[- ]part|provider/],
  ['cloud', 'cloud services', /cloud|saas|iaas|paas/,
    ['ISO27001 5.23', '~NISTCSF GV.SC']],

  // ---------------- People
  ['training', 'security awareness training', /training|awareness|phishing simulation|educat/,
    ['ISO27001 6.3', 'NIST80053 AT-2', 'CIS 14', 'NISTCSF PR.AT', 'HIPAA 164.308(a)(5)', 'SOC2 CC1.4', '~PCIDSS 12']],
  ['screening', 'background screening', /background (check|screen)|screen(ing|ed) .{0,20}(candidate|employee|personnel|hire)|pre-employment|vetting/,
    ['ISO27001 6.1', 'NIST80053 PS-3', '~HIPAA 164.308(a)(3)', '~SOC2 CC1.4']],
  ['nda', 'confidentiality agreements', /non-disclosure|\bnda\b|confidentiality (agreement|undertaking)/,
    ['ISO27001 6.6', 'ISO27001 6.2', '~SOC2 CC1.1']],
  ['employment-terms', 'terms of employment', /terms (and conditions )?of employment|employment contract|code of conduct/,
    ['ISO27001 6.2', 'SOC2 CC1.1', '~NIST80053 PL-4']],
  ['discipline', 'disciplinary process', /disciplin|sanction|termination of employment|consequence/,
    ['ISO27001 6.4', 'NIST80053 PS-8', 'SOC2 CC1.5', '~HIPAA 164.308(a)(1)']],
  ['aup', 'acceptable use', /acceptable use|rules of behavio|personal use|prohibited use/,
    ['ISO27001 5.10', 'NIST80053 PL-4', 'HIPAA 164.310(b)']],

  // ---------------- Assets and data
  ['inventory', 'asset inventory', /inventory|asset register|\bcmdb\b|(record|track)\w* .{0,20}assets/,
    ['ISO27001 5.9', 'NIST80053 CM-8', 'CIS 1', 'NISTCSF ID.AM', '~CIS 2']],
  ['asset-owner', 'asset ownership', /asset owner|owner of (each|every|the) asset|assigned (an )?owner/,
    ['ISO27001 5.9', '~NISTCSF ID.AM']],
  ['return', 'return of assets', /return (of )?(all )?(company |organi[sz]ational )?(assets|equipment|devices|property)/,
    ['ISO27001 5.11', '~NIST80053 PS-4']],
  ['disposal', 'secure disposal', /dispos|sanitiz|wip(e|ing)|destr(oy|uction)|shred|degauss|re-?use of equipment/,
    ['ISO27001 7.14', 'ISO27001 8.10', 'NIST80053 MP-6', 'SOC2 CC6.5', 'SOC2 C1.2', '~HIPAA 164.310(d)(1)']],
  ['classify', 'information classification', /classif\w* .{0,30}(data|information|asset)|(data|information) classif|label|confidential(ity)? level|public, internal/,
    ['ISO27001 5.12', 'ISO27001 5.13', 'SOC2 C1.1', 'CIS 3', '~NISTCSF PR.DS']],
  ['retention', 'retention of records', /retention|retain\w*|records? (management|protection)|archiv/,
    ['ISO27001 5.33', 'ISO27001 8.10', '~GDPR Art. 5', '~SOC2 C1.2']],
  ['dlp', 'data leakage prevention', /data loss|leakage|\bdlp\b|exfiltrat/,
    ['ISO27001 8.12', 'CIS 3', 'SOC2 CC6.7', '~NISTCSF PR.DS']],
  ['transfer', 'information transfer', /information transfer|shar\w* .{0,30}(externally|with third|outside)|file transfer|transfer\w* (of )?(data|information)/,
    ['ISO27001 5.14', 'SOC2 CC6.7', '~NIST80053 SC-8']],
  ['integrity', 'data integrity', /integrity|unauthori[sz]ed (alteration|modification)|tamper/,
    ['HIPAA 164.312(c)(1)', '~NISTCSF PR.DS']],

  // ---------------- Privacy
  ['privacy', 'protection of personal data', /personal (data|information)|\bpii\b|\bphi\b|privacy|data subject/,
    ['ISO27001 5.34', 'GDPR Art. 5', 'GDPR Art. 32', 'NIST80053 PT-1', '~GDPR Art. 24']],
  ['lawful', 'lawful basis and consent', /lawful basis|legal basis|consent|legitimate interest/,
    ['GDPR Art. 6', '~GDPR Art. 5']],
  ['dpia', 'impact assessments', /impact assessment|\bdpia\b|\bpia\b/,
    ['GDPR Art. 35', '~NIST80053 RA-3']],
  ['ropa', 'records of processing', /records? of processing|\bropa\b|processing (register|activities)/,
    ['GDPR Art. 30']],
  ['dpo', 'data protection officer', /data protection officer|\bdpo\b/,
    ['GDPR Art. 37', '~GDPR Art. 24']],
  ['by-design', 'privacy by design', /by design|by default|data minimi[sz]|purpose limitation/,
    ['GDPR Art. 25', '~GDPR Art. 5', '~NIST80053 SA-8']],
  ['dsar', 'data subject rights', /subject access|\bdsar\b|right to (erasure|access|rectification|be forgotten)|data subject request/,
    ['GDPR Art. 5', '~GDPR Art. 24', '~ISO27001 5.34']],

  // ---------------- Physical
  ['physical', 'physical access control', /badge|physical (access|entry|security)|visitor|premises|data cent(er|re)|secure area|server room|office access|keycard/,
    ['ISO27001 7.2', 'ISO27001 7.1', 'NIST80053 PE-3', 'SOC2 CC6.4', 'PCIDSS 9', 'HIPAA 164.310(a)(1)']],
  ['cctv', 'physical security monitoring', /cctv|surveillance camera|intrusion (alarm|detection)|security guard/,
    ['ISO27001 7.4', '~NIST80053 PE-3']],
  ['clear-desk', 'clear desk', /clear desk|clean desk|printouts|unattended (document|paper)/,
    ['ISO27001 7.7']],
  ['environment', 'environmental protection', /fire|flood|environmental|power (supply|outage)|\bups\b|hvac|temperature|humidity|utilit/,
    ['ISO27001 7.5', 'ISO27001 7.11', '~SOC2 A1.2']],
  ['off-premises', 'equipment off-site', /off-?(site|premises)|travel|outside (the )?(office|premises)/,
    ['ISO27001 7.9', '~ISO27001 6.7']],
  ['maintenance', 'equipment maintenance', /maintenance|maintain\w* equipment/,
    ['ISO27001 7.13', '~NIST80053 MA-1']],

  // ---------------- Governance, risk, compliance
  ['risk', 'risk assessment', /risk assessment|assess\w* .{0,20}risks?|risk register|risk treatment|risk analysis|risk appetite|risk tolerance/,
    ['NIST80053 RA-3', 'SOC2 CC3.2', 'NISTCSF ID.RA', 'NISTCSF GV.RM', 'HIPAA 164.308(a)(1)', '~NIST80053 RA-1']],
  ['policy-gov', 'policy approval and review', /polic(y|ies) .{0,40}(review|approv|publish|communicat)|(review|approv)\w* .{0,30}polic(y|ies)/,
    ['ISO27001 5.1', 'NISTCSF GV.PO', 'SOC2 CC5.3', '~NIST80053 PM-1']],
  ['roles', 'roles and responsibilities', /roles? and responsibilit|responsib\w* for|accountab|assigned (security )?responsib/,
    ['ISO27001 5.2', 'NISTCSF GV.RR', 'SOC2 CC1.3', 'HIPAA 164.308(a)(2)']],
  ['mgmt', 'management direction', /management (shall|must) (support|ensure|provide)|senior management|leadership|board/,
    ['ISO27001 5.4', 'SOC2 CC1.2', 'NISTCSF GV.OV']],
  ['audit', 'independent review and compliance checks', /internal audit|independent (review|audit|assessment)|compliance (is|shall be|must be) (verified|monitored|checked)|(verif|monitor)\w* compliance|self-assessment/,
    ['ISO27001 5.35', 'ISO27001 5.36', 'SOC2 CC4.1', 'NIST80053 CA-7', 'HIPAA 164.308(a)(8)']],
  ['deficiency', 'track deficiencies', /deficienc|corrective action|non-?conformit|findings? (shall|must) be (tracked|remediated)/,
    ['SOC2 CC4.2', '~ISO27001 5.36']],
  ['legal', 'legal and regulatory requirements', /legal|regulatory|statutory|contractual requirement|applicable law/,
    ['ISO27001 5.31', '~GDPR Art. 24']],
  ['ip', 'intellectual property', /intellectual property|licen[cs]e|copyright/,
    ['ISO27001 5.32']],
  ['authorities', 'contact with authorities', /law enforcement|authorities|regulators?\b/,
    ['ISO27001 5.5']],
  ['procedures', 'documented procedures', /documented (operating )?procedure|runbook|playbook|standard operating/,
    ['ISO27001 5.37', '~NIST80053 IR-8']],
  ['exceptions', 'policy exceptions', /exception|waiver|deviation/,
    ['~ISO27001 5.36', '~SOC2 CC5.3']],
];

const CONCEPTS = C.map(([id, label, re, refs, need]) => ({
  id, label, re, need, refs: refs.map((r) => (r[0] === '~' ? { key: r.slice(1), w: 1.5 } : { key: r, w: 3 })),
}));

const keyOf = (c) => `${c.framework_code} ${c.ref}`;
const STOP = new Set(['must', 'shall', 'with', 'from', 'that', 'this', 'their', 'than', 'have', 'been', 'into', 'when', 'within', 'least', 'other', 'every', 'organizational', 'organization', 'information', 'security', 'policy', 'procedures', 'management', 'systems', 'system', 'data', 'all']);
const stems = (t) => (String(t).toLowerCase().match(/[a-z]{4,}/g) || []).filter((w) => !STOP.has(w)).map((w) => w.slice(0, 6));

// The catalogue is indexed once per control list (the list object is stable for a session).
const cache = new WeakMap();
function indexOf(controls) {
  if (cache.has(controls)) return cache.get(controls);
  const byKey = new Map(controls.map((c) => [keyOf(c), c]));
  const df = new Map();
  const docs = controls.map((c) => { const s = new Set(stems(`${c.title} ${c.family || ''}`)); s.forEach((w) => df.set(w, (df.get(w) || 0) + 1)); return s; });
  const idf = (w) => Math.log(1 + controls.length / (df.get(w) || 1));
  const idx = { byKey, docs, idf };
  cache.set(controls, idx);
  return idx;
}

// Which concepts a statement matches, with the phrase that matched (shown to the analyst).
// Names of other documents ("in accordance with the Data Retention and Destruction Policy") say
// nothing about what this statement requires, so they are removed before matching.
const DOC_NAME = /\b(?:the\s+)?(?:[A-Z][\w&'-]*\s+){1,6}(?:Policy|Standard|Guideline|Guidelines)\b/g;
export function conceptsIn(text) {
  const t = String(text || '').replace(DOC_NAME, ' ').toLowerCase();
  const out = [];
  for (const c of CONCEPTS) {
    if (c.need && !c.need.test(t)) continue;
    const m = t.match(c.re);
    if (m) out.push({ concept: c, phrase: (m[0] || '').trim(), at: m.index });
  }
  return out.sort((a, b) => a.at - b.at);
}

/**
 * Rank controls for one statement.
 * @returns [{ control, score, confidence: 'high'|'medium', reason }] best first, at most `perFramework` per framework.
 */
export function suggestMappings(text, controls, { frameworks = null, perFramework = 2, exclude = [] } = {}) {
  if (!text || !controls?.length) return [];
  const { byKey, docs, idf } = indexOf(controls);
  const skip = new Set(exclude);
  const allow = frameworks ? new Set(frameworks) : null;
  const scores = new Map(); // control id -> { score, reasons:Set }
  const bump = (c, s, why) => {
    if (!c || skip.has(c.id) || (allow && !allow.has(c.framework_code))) return;
    const e = scores.get(c.id) || { c, score: 0, concept: 0, reasons: new Set() };
    e.score += s; if (why) e.reasons.add(why);
    scores.set(c.id, e);
    return e;
  };

  // 1. Concept table.
  const hits = conceptsIn(text);
  hits.forEach(({ concept, phrase }, rank) => {
    // Earlier concepts in the statement carry slightly more weight than incidental ones.
    const decay = rank === 0 ? 1 : rank === 1 ? 0.9 : 0.8;
    for (const r of concept.refs) {
      const e = bump(byKey.get(r.key), r.w * decay, `“${phrase}” → ${concept.label}`);
      if (e) e.concept = Math.max(e.concept, r.w);
    }
  });

  // 2. Fallback: shared themes plus rare title words. Applies to every control, so custom
  //    frameworks get suggestions too, and it breaks ties between concept matches.
  const themes = suggestThemes(text);
  const words = new Set(stems(text));
  if (themes.length || words.size) {
    controls.forEach((c, i) => {
      if (skip.has(c.id) || (allow && !allow.has(c.framework_code))) return;
      const ct = (c.themes || '').split(',').filter(Boolean);
      const overlap = ct.filter((t) => themes.includes(t)).length;
      let title = 0; const shared = [];
      docs[i].forEach((w) => { if (words.has(w)) { title += idf(w); shared.push(w); } });
      if (!overlap && title < 2.5) return;
      // When the concept table recognised the statement, the fallback only breaks ties.
      const s = (overlap * 0.6 + Math.min(title, 6) * 0.35) * (hits.length ? 0.35 : 1);
      if (s < (hits.length ? 0.3 : 0.9)) return;
      bump(c, s, shared.length ? `shares “${shared.slice(0, 2).join('”, “')}” with the control title` : null);
    });
  }

  const ranked = [...scores.values()]
    .map((e) => ({ control: e.c, score: e.score, confidence: e.concept >= 3 && e.score >= 3 ? 'high' : 'medium', reason: [...e.reasons][0] || 'Shares the statement’s topic' }))
    .filter((x) => x.confidence === 'high' || x.score >= 1.6)
    .sort((a, b) => b.score - a.score);

  // Keep the best per framework (and a close runner-up when asked for more than one).
  const per = new Map();
  const out = [];
  for (const x of ranked) {
    const fw = x.control.framework_code;
    const list = per.get(fw) || [];
    if (list.length >= perFramework) continue;
    if (list.length && (x.confidence !== 'high' || x.score < list[0].score * 0.7)) continue;
    list.push(x); per.set(fw, list); out.push(x);
  }
  return out;
}

// The frameworks a policy already uses, else a sensible default from what the workspace has.
export function defaultFrameworks(p, controls, available = []) {
  const byId = new Map(controls.map((c) => [c.id, c]));
  const used = [...new Set((p?.statements || []).flatMap((s) => s.controls || []).concat(p?.ref_controls || []).map((id) => byId.get(id)?.framework_code).filter(Boolean))];
  if (used.length) return used;
  const codes = new Set(available.map((f) => f.code || f));
  const pref = ['ISO27001', 'NISTCSF'].filter((c) => codes.has(c));
  return pref.length ? pref : [...codes].slice(0, 2);
}

// Suggestions for every statement that has none yet. Returns Map(statementId -> suggestions).
export function autoMapStatements(statements, controls, opts = {}) {
  const out = new Map();
  for (const s of statements) {
    if (!s.text?.trim()) continue;
    if (!opts.includeMapped && (s.controls || []).length) continue;
    const list = suggestMappings(s.text, controls, { ...opts, exclude: [...(s.controls || []), ...(opts.rejected?.get?.(s.id) || [])] });
    if (list.length) out.set(s.id, list);
  }
  return out;
}
