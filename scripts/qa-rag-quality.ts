import type { VerticalId } from '../src/lib/agents/core/types.ts';
import type { SupabaseClient } from '@supabase/supabase-js';
import { retrieveKnowledge } from '../src/lib/knowledge/retrieval.ts';
import { createAdminClient } from '../src/lib/supabase/admin.ts';

export interface RetrievalQualityCase {
  name: string;
  verticalId: VerticalId;
  query: string;
  expectedTopSourceKey: string;
}

export const RETRIEVAL_QUALITY_CASES: readonly RetrievalQualityCase[] = [
  {
    name: 'brake symptoms rank brake guidance first',
    verticalId: 'auto_repair',
    query: 'My brakes are grinding and the car vibrates when I stop.',
    expectedTopSourceKey: 'auto_repair/brake-noise',
  },
  {
    name: 'oil question ranks oil-service guidance first',
    verticalId: 'auto_repair',
    query: 'What oil should I use and how often should it be changed?',
    expectedTopSourceKey: 'auto_repair/oil-service',
  },
  {
    name: 'warning-light question ranks diagnostic guidance first',
    verticalId: 'auto_repair',
    query:
      'My check engine light came on. Does the code tell me exactly which part failed?',
    expectedTopSourceKey: 'auto_repair/warning-lights',
  },
];
const QA_BUSINESS_ID = '00000000-0000-4000-8000-000000000001';

export async function runQualityCase(
  supabase: SupabaseClient,
  testCase: RetrievalQualityCase,
): Promise<void> {
  const matches = await retrieveKnowledge(supabase, {
    businessId: QA_BUSINESS_ID,
    verticalId: testCase.verticalId,
    query: testCase.query,
    matchCount: 3,
  });

  const topMatch = matches[0];

  if (!topMatch) {
    throw new Error(`${testCase.name}: no match met the production threshold`);
  }

  if (topMatch.source_key !== testCase.expectedTopSourceKey) {
    throw new Error(
      `${testCase.name}: expected ${testCase.expectedTopSourceKey}, received ${topMatch.source_key}`,
    );
  }

  console.log(
    `✓ ${testCase.name} (${topMatch.source_key}, ${topMatch.similarity.toFixed(3)})`,
  );
}

function fail(message: string): never {
  console.error(`[rag-quality] ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const admin = createAdminClient();

  if (!admin) {
    fail('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  }

  if (!process.env.OPENAI_API_KEY) {
    fail('Missing OPENAI_API_KEY.');
  }

  for (const testCase of RETRIEVAL_QUALITY_CASES) {
    await runQualityCase(admin, testCase);
  }

  console.log(
    `[rag-quality] ${RETRIEVAL_QUALITY_CASES.length}/${RETRIEVAL_QUALITY_CASES.length} cases passed.`,
  );
}

void main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error));
});