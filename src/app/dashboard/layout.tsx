import { redirect } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import DemoBanner from '@/components/DemoBanner';
import { createClient } from '@/lib/supabase/server';
import { getActiveBusiness } from '@/lib/supabase/businesses';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const isConfigured = !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );

  let isSignedIn = false;
  let businessName: string | undefined;

  if (isConfigured) {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    if (data.user) {
      isSignedIn = true;
      const business = await getActiveBusiness(supabase);
      if (!business) {
        redirect('/onboarding');
      }
      businessName = business.name;
    }
  }

  return (
    <div className="flex h-screen overflow-hidden bg-neutral-50">
      <Sidebar businessName={businessName} />
      <div className="flex-1 flex flex-col overflow-y-auto">
        {!isSignedIn && <DemoBanner />}
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
