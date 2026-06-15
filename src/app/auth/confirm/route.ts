import { type NextRequest, NextResponse } from 'next/server';
import { type EmailOtpType } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';

// Verifies Supabase email links (password recovery, email confirmation) and redirects to `next`.
// The email template's redirect must point here with token_hash + type (standard @supabase/ssr flow).
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;
  const next = searchParams.get('next') ?? '/dashboard';

  // Only allow same-origin relative redirects.
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard';

  if (token_hash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error) {
      return NextResponse.redirect(new URL(safeNext, request.url));
    }
  }

  return NextResponse.redirect(
    new URL('/login?error=link-expired', request.url),
  );
}
