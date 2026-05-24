// Pure role-label mapping for call transcript display.
// Maps DB role strings to UI display labels.

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function roleLabel(role: string | null | undefined): string {
  if (!role) return 'Unknown';
  const r = role.toLowerCase();
  if (r === 'ai' || r === 'agent' || r === 'assistant' || r === 'front_desk') return 'Front desk';
  if (r === 'caller' || r === 'user' || r === 'customer') return 'Caller';
  return cap(role);
}
