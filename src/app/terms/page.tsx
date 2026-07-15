import type { Metadata } from 'next';
import LegalShell, { LegalSection } from '@/components/LegalShell';
import {
  SITE_NAME,
  SUPPORT_EMAIL,
  OPERATOR_NAME,
  OPERATOR_JURISDICTION,
  LEGAL_LAST_UPDATED,
} from '@/lib/site';

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: `The terms that govern use of ${SITE_NAME}.`,
};

// Legal content — not legal advice. Have a lawyer review before a broad public (self-serve) launch.
// Operator identity + support email: src/lib/site.ts. Data handling: see /privacy.
export default function TermsPage() {
  return (
    <LegalShell title="Terms of Service" updated={LEGAL_LAST_UPDATED}>
      <p>
        These terms govern your use of {SITE_NAME}, a virtual front desk service operated by{' '}
        {OPERATOR_NAME} in {OPERATOR_JURISDICTION}. By creating an account or using the service you
        agree to these terms.
      </p>

      <LegalSection title="The service">
        <p>
          {SITE_NAME} provides an automated front desk that answers customer calls for your
          business, answers questions from the information you provide, and captures call
          summaries, appointment requests, and service requests for your staff to review. The
          assistant is automated — it is not a human receptionist and never claims to be one.
        </p>
      </LegalSection>

      <LegalSection title="Requests are captured, not confirmed">
        <p>
          Appointment and service requests captured on a call are <strong>pending</strong> until
          your staff confirms them. {SITE_NAME} does not guarantee availability, pricing, or
          scheduling on your behalf, and you remain responsible for following up with your
          customers.
        </p>
      </LegalSection>

      <LegalSection title="Your responsibilities">
        <p>
          You are responsible for the accuracy of the business information and knowledge base
          content you provide, for reviewing captured requests promptly, and for complying with
          the laws that apply to your business — including any disclosure obligations to your
          callers in your jurisdiction.
        </p>
        <p>
          You agree not to use the service for unlawful purposes, to impersonate another business,
          to attempt to access another account&rsquo;s data, or to abuse, overload, or reverse
          engineer the service.
        </p>
      </LegalSection>

      <LegalSection title="Not for emergencies, medical, or legal advice">
        <p>
          The front desk handles administrative requests only — questions, appointments, and
          service requests. It does not provide medical, legal, or financial advice and must not be
          relied on for emergencies. Clinics and health-related businesses may use {SITE_NAME} for
          administrative front desk tasks only; it is not a medical service and is not intended to
          store health records.
        </p>
      </LegalSection>

      <LegalSection title="Call transcripts">
        <p>
          Calls handled by the service are transcribed and summarized so your staff can review them.
          You are responsible for ensuring your use of call transcription is permitted for your
          business and region, and for providing any caller notice or consent required in your
          jurisdiction (see &ldquo;Your responsibilities&rdquo; above). Where your jurisdiction
          requires it, {SITE_NAME} can provide a short disclosure at the start of calls. The
          sub-processors we use and where data is processed are described in the{' '}
          <a className="text-orange-600 hover:underline" href="/privacy">Privacy Policy</a>.
        </p>
      </LegalSection>

      <LegalSection title="Activation, billing &amp; access">
        <p>
          {SITE_NAME} is currently activated and billed manually: we set up and approve each business
          directly, and there is no self-serve checkout. Access to paid features — the phone answering
          service and in-dashboard test calls — requires an active, approved subscription. If your
          subscription is inactive, canceled, or unpaid, paid features (including answering forwarded
          calls) may be suspended until it is reactivated. We will never charge you without your
          explicit agreement to a plan, and any pricing is communicated in advance.
        </p>
      </LegalSection>

      <LegalSection title="Availability and changes">
        <p>
          We aim for reliable service but do not guarantee uninterrupted availability. Calls may
          occasionally fail to connect, transcripts may contain errors, and features may change as
          the service evolves. We may suspend accounts that violate these terms.
        </p>
      </LegalSection>

      <LegalSection title="Limitation of liability">
        <p>
          To the maximum extent permitted by law, {SITE_NAME} is provided &ldquo;as is&rdquo; and
          our total liability for any claim related to the service is limited to the amount you
          paid for the service in the twelve months before the claim (or $100 CAD if you have paid
          nothing). We are not liable for indirect damages such as lost bookings, lost revenue, or
          lost data.
        </p>
      </LegalSection>

      <LegalSection title="Termination">
        <p>
          You can delete your account and all associated data at any time from{' '}
          <strong>Settings &rarr; Delete account &amp; all data</strong>, or by contacting{' '}
          <a className="text-orange-600 hover:underline" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
          You can also stop using the service at any time.
        </p>
      </LegalSection>

      <LegalSection title="Governing law">
        <p>These terms are governed by the laws of British Columbia, Canada.</p>
      </LegalSection>

      <LegalSection title="Contact">
        <p>
          Questions about these terms:{' '}
          <a className="text-orange-600 hover:underline" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
        </p>
      </LegalSection>
    </LegalShell>
  );
}
