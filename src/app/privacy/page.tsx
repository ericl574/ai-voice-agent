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
  title: 'Privacy Policy',
  description: `How ${SITE_NAME} collects, uses, and protects business and caller information.`,
};

// Legal content — expanded with a full sub-processor list, international-transfer disclosure, and the
// in-app self-serve deletion path. Still NOT legal advice: have a lawyer review against BC PIPA /
// PIPEDA before a broad public (self-serve) launch. Operator identity + support email: src/lib/site.ts.
export default function PrivacyPage() {
  return (
    <LegalShell title="Privacy Policy" updated={LEGAL_LAST_UPDATED}>
      <p>
        {SITE_NAME} (&ldquo;we&rdquo;, &ldquo;us&rdquo;) is a virtual front desk service for local
        service businesses, operated by {OPERATOR_NAME} in {OPERATOR_JURISDICTION}. This policy
        explains what information we collect, how we use it, and the choices you have.
      </p>

      <LegalSection title="Information we collect">
        <p>
          <strong>Account information.</strong> When a business creates an account we collect an
          email address, password (stored as a secure hash by our authentication provider), and the
          business profile you enter — business name, type, contact details, hours, and front desk
          configuration.
        </p>
        <p>
          <strong>Call information.</strong> When your front desk handles a call, we process the
          audio to run the conversation and store a written transcript, a call summary, and any
          details the caller chooses to share — such as their name, phone number, and the
          appointment or service they requested. Caller audio is processed in real time to run the
          call; we do not keep audio recordings as part of the saved call record.
        </p>
        <p>
          <strong>Knowledge base content.</strong> The questions and answers you enter so your front
          desk can answer callers accurately.
        </p>
      </LegalSection>

      <LegalSection title="How we use information">
        <p>
          We use this information only to provide the service: answering your business&rsquo;s
          calls, creating call summaries and appointment/service requests for your staff, and
          maintaining your account. We do not sell personal information, and we do not use your
          business&rsquo;s data or your callers&rsquo; data for advertising.
        </p>
      </LegalSection>

      <LegalSection title="Sub-processors">
        <p>
          We rely on a small number of service providers (sub-processors) to run the service. Each
          processes data only to provide its part of the service, under our instructions:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <strong>OpenAI</strong> — real-time speech and language processing that runs live calls,
            transcription, and call summaries.
          </li>
          <li>
            <strong>Supabase</strong> — database and account authentication; your business profile,
            call transcripts, summaries, and requests are stored here.
          </li>
          <li>
            <strong>Twilio</strong> — telephony that connects inbound phone calls to the service, and
            the optional SMS report alert.
          </li>
          <li>
            <strong>Resend</strong> — delivery of your daily email report.
          </li>
          <li>
            <strong>Vercel</strong> — hosting for the web application.
          </li>
          <li>
            <strong>Railway</strong> — hosting for the real-time call bridge that carries call audio
            between the phone network and OpenAI.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Where your data is processed (international transfer)">
        <p>
          These sub-processors process and store data on servers located{' '}
          <strong>outside Canada, including in the United States</strong>. Call transcripts and the
          details a caller shares are personal information; by using {SITE_NAME} you consent to this
          cross-border processing. Personal information handled outside Canada may be subject to the
          laws of the country where it is processed, including lawful access requests by courts and
          government authorities. We do not sell personal information and do not use it for
          advertising.
        </p>
      </LegalSection>

      <LegalSection title="Automated front desk disclosure">
        <p>
          Calls handled by {SITE_NAME} are answered by an automated front desk assistant, not a
          human receptionist. The assistant never claims to be human, and confirms this plainly if
          a caller asks. Appointment and service requests captured on a call are marked pending
          until the business&rsquo;s staff confirms them.
        </p>
      </LegalSection>

      <LegalSection title="Data retention and deletion">
        <p>
          Call transcripts, summaries, and requests are retained while the business account is
          active so staff can review them.
        </p>
        <p>
          A business owner can <strong>delete their entire account and all associated data at any
          time</strong> from <strong>Settings &rarr; Delete account &amp; all data</strong> — this
          permanently removes the business, its calls, transcripts, appointments, service requests,
          knowledge base, and login. You can also request deletion of specific call records, or of
          your whole account, by contacting{' '}
          <a className="text-orange-600 hover:underline" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>;
          we aim to complete emailed requests within 30 days.
        </p>
        <p>
          Callers who want their information removed can contact either the business they called or
          us at the address above, and we will work with the business to remove it.
        </p>
      </LegalSection>

      <LegalSection title="Cookies">
        <p>
          We use only the cookies required to keep you signed in (authentication session cookies).
          We do not use advertising or cross-site tracking cookies.
        </p>
      </LegalSection>

      <LegalSection title="Security">
        <p>
          Data is encrypted in transit, access is restricted per business account (each business
          can only see its own data), and API keys for our providers are kept server-side only. No
          method of storage is perfectly secure, but we design the service so the minimum necessary
          information is collected in the first place.
        </p>
      </LegalSection>

      <LegalSection title="Your rights">
        <p>
          Under Canadian privacy law (including BC&rsquo;s Personal Information Protection Act),
          you may request access to, correction of, or deletion of personal information we hold.
          Contact{' '}
          <a className="text-orange-600 hover:underline" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>{' '}
          and we will respond within a reasonable time.
        </p>
      </LegalSection>

      <LegalSection title="Changes to this policy">
        <p>
          If we make material changes we will update this page and the date above, and notify
          active business accounts by email.
        </p>
      </LegalSection>
    </LegalShell>
  );
}
