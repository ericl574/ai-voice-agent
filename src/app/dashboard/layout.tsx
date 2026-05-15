import Sidebar from '@/components/Sidebar';
import DemoBanner from '@/components/DemoBanner';
import { createClient } from '@/lib/supabase/server';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const isConfigured = !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );

  let isSignedIn = false;
  if (isConfigured) {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    isSignedIn = !!data.user;
  }

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-auto">
        {!isSignedIn && <DemoBanner />}
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
