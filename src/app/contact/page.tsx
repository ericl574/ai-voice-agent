import type { Metadata } from 'next';
import LegalShell, { LegalSection } from '@/components/LegalShell';
import PilotRequestForm from '@/components/PilotRequestForm';
import { SITE_NAME, SUPPORT_EMAIL } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Start a pilot',
  description: `Start a ${SITE_NAME} pilot — after-hours call capture and a morning report for your business.`,
};

export default function ContactPage() {
  return (
    <LegalShell title="Start a pilot">
      <p>
        {SITE_NAME} is onboarding a small number of local service businesses. Tell us about your
        business and we&rsquo;ll set it up with you — forward the calls you miss after hours, and
        start getting one clear report every morning. Setup help is included; no account needed to
        get started.
      </p>

      <PilotRequestForm />

      <LegalSection title="Prefer email, or have a question?">
        <p>
          Email{' '}
          <a className="text-orange-600 hover:underline" href={`mailto:${SUPPORT_EMAIL}`}>
            {SUPPORT_EMAIL}
          </a>{' '}
          with your business name and a short note. We aim to respond within one business day.
        </p>
      </LegalSection>

      <LegalSection title="Privacy and data requests">
        <p>
          To request access to or deletion of your data (as a business or as a caller), use the same
          address with the subject line &ldquo;Data request&rdquo;. See the{' '}
          <a className="text-orange-600 hover:underline" href="/privacy">Privacy Policy</a> for what
          we store.
        </p>
      </LegalSection>
    </LegalShell>
  );
}
