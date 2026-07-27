// Idempotently embeds and upserts the shared auto-repair knowledge dataset.
// Requires OPENAI_API_KEY, NEXT_PUBLIC_SUPABASE_URL, and
// SUPABASE_SERVICE_ROLE_KEY in the server environment.

import { createAdminClient } from '../src/lib/supabase/admin.ts';
import {
  AUTO_REPAIR_KNOWLEDGE,
  AUTO_REPAIR_VERTICAL_ID,
} from '../src/lib/knowledge/autoRepairKnowledge.ts';
import {
  ingestVerticalKnowledge,
} from '../src/lib/knowledge/ingestion.ts';

function fail(message: string): never {
  console.error(`[knowledge] ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const admin = createAdminClient();

  if (!admin) {
    fail(
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.',
    );
  }

  const count = await ingestVerticalKnowledge(
    admin,
    AUTO_REPAIR_VERTICAL_ID,
    AUTO_REPAIR_KNOWLEDGE,
  );

  console.log(
    `[knowledge] Seeded ${count} auto-repair knowledge chunks.`,
  );
}

void main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error));
});