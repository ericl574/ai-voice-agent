import type { Metadata } from 'next';
import LegalShell, { LegalSection } from '@/components/LegalShell';
import { SITE_NAME, SUPPORT_EMAIL } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Contact & Support',
  description: `Get help with ${SITE_NAME} or ask a question.`,
};

export default function ContactPage() {
  return (
    <LegalShell title="Contact & Support">
      <p>
        Whether you&rsquo;re a business using {SITE_NAME}, considering it, or a caller with a
        question about your information — we&rsquo;re happy to help.
      </p>

      <LegalSection title="Support">
        <p>
          Email{' '}
          <a className="text-orange-600 hover:underline" href={`mailto:${SUPPORT_EMAIL}`}>
            {SUPPORT_EMAIL}
          </a>{' '}
          and include your business name and a short description of the issue. For call-related
          problems, the approximate time of the call helps us find it quickly. We aim to respond
          within one business day.
        </p>
      </LegalSection>

      <LegalSection title="Privacy and data requests">
        <p>
          To request access to or deletion of your data (as a business or as a caller), use the
          same address with the subject line &ldquo;Data request&rdquo;. See the{' '}
          <a className="text-orange-600 hover:underline" href="/privacy">Privacy Policy</a> for
          details on what we store.
        </p>
      </LegalSection>

      <LegalSection title="Interested in the pilot?">
        <p>
          {SITE_NAME} is onboarding a small number of local service businesses. If you&rsquo;d like
          a walkthrough with your own business&rsquo;s details, reach out — setup help is included.
        </p>
      </LegalSection>
    </LegalShell>
  );
}
