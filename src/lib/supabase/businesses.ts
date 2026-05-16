export interface Business {
  id: string;
  name: string;
  business_type: string;
  phone: string | null;
  email: string | null;
  city: string | null;
  region: string | null;
  timezone: string;
  ai_agent_name: string | null;
  greeting: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

// Accepts both server and browser Supabase clients (no generated DB types required)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getActiveBusiness(supabase: any): Promise<Business | null> {
  try {
    const { data: member, error: memberError } = await supabase
      .from('business_members')
      .select('business_id')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (memberError || !member?.business_id) return null;

    const { data: business, error: bizError } = await supabase
      .from('businesses')
      .select('*')
      .eq('id', member.business_id)
      .maybeSingle();

    if (bizError || !business) return null;
    return business as Business;
  } catch {
    return null;
  }
}
