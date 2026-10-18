// A complete, review-ready example policy with notes on every field. Used by the
// "Annotated example policy" guide, which can also copy it into a workspace as a draft.
// Controls are "FRAMEWORK:ref" strings, resolved against the workspace's control library.

export const EXAMPLE_POLICY = {
  title: 'Incident Response Policy',
  policy_type: 'incident-response',
  owner: 'Chief Information Security Officer (CISO)',
  classification: 'Internal',
  review_cycle_months: 12,
  purpose: 'This policy exists to ensure that information security incidents affecting the organization are detected, reported, contained and resolved in a consistent, documented way, so that harm to customers, employees and the business is kept to a minimum. It sets the minimum requirements for reporting, classifying, escalating, investigating and learning from incidents, and supports our obligations under ISO/IEC 27001, NIST SP 800-53 and the GDPR.',
  scope: 'This policy applies to all employees, contractors, consultants, temporary staff and third parties who access the organization\'s information or systems. It covers all information systems, networks, cloud services, applications, endpoints and data owned, operated or managed by or on behalf of the organization, wherever they are located.',
  statements: [
    { text: 'The Information Security Office must maintain a documented incident response plan, with playbooks for the five most likely incident types, and must review and update it at least annually.',
      controls: ['ISO27001:5.24', 'NIST80053:IR-8'] },
    { text: 'All personnel must report suspected security incidents to the Security Operations Center within 1 hour of discovery, using the service portal or the 24/7 security hotline.',
      controls: ['ISO27001:6.8', 'NIST80053:IR-6'] },
    { text: 'The Security Operations Center must triage every reported incident within 4 hours and assign a severity level of Critical, High, Medium or Low using the severity matrix in the incident response plan.',
      controls: ['ISO27001:5.25'] },
    { text: 'Incidents classified as Critical or High must be escalated to the Incident Commander within 1 hour of classification, and the Incident Commander must convene the Incident Response Team.',
      controls: ['ISO27001:5.26', 'NIST80053:IR-4'] },
    { text: 'For any breach of personal data, the Data Protection Officer must notify the relevant supervisory authority within 72 hours of becoming aware of it, and must notify affected data subjects within 72 hours when the breach is likely to result in a high risk to them.',
      controls: ['GDPR:Art. 33', 'GDPR:Art. 34'] },
    { text: 'The Incident Response Team must preserve logs, disk images and other evidence for every Critical or High incident and must record a chain of custody for each item collected.',
      controls: ['ISO27001:5.28'] },
    { text: 'The Incident Commander must complete a post-incident review, covering root cause and lessons learned, within 10 business days of closing every Critical or High incident.',
      controls: ['ISO27001:5.27'] },
    { text: 'The Information Security Office must test the incident response plan through a tabletop exercise at least annually and must track every resulting action to completion.',
      controls: ['CIS:17'] },
  ],
  roles: [
    { role: 'Policy Owner: Chief Information Security Officer (CISO)', responsibility: 'Owns this policy and the incident response plan through the Information Security Office, approves changes, and ensures the policy is reviewed at least annually.' },
    { role: 'Security Operations Center (SOC)', responsibility: 'Receives incident reports 24/7, triages and classifies incidents, and coordinates initial containment.' },
    { role: 'Incident Commander', responsibility: 'Leads the response to Critical and High incidents, convenes the Incident Response Team, and owns the post-incident review.' },
    { role: 'Data Protection Officer (DPO)', responsibility: 'Assesses personal data breaches and notifies supervisory authorities and affected data subjects.' },
    { role: 'All personnel (users)', responsibility: 'Report suspected incidents within 1 hour of discovery and cooperate fully with investigations.' },
    { role: 'Management', responsibility: 'Provides the people and budget needed for incident response, and supports disciplinary and legal follow-up.' },
  ],
  enforcement: 'Compliance with this policy is verified through a quarterly review of incident records, the annual internal audit and the annual tabletop exercise. Failing to report a known or suspected incident, or deliberately interfering with an investigation, will result in disciplinary action up to and including termination of employment or contract, and may be referred to law enforcement. Deviations from this policy must be requested through the Policy Exception process and approved by the CISO before the deviation occurs.',
  ref_controls: ['ISO27001:5.24', 'NISTCSF:RS.MA'],
  related_docs: 'Incident Response Plan (IRP-01); Incident Severity Matrix; Information Security Policy; Data Protection Policy; Business Continuity Plan',
};
