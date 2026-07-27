import { createHash } from 'node:crypto';
import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  embedTexts,
} from './embeddings.ts';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface KnowledgeSeedChunk {
  sourceKey: string;
  title: string;
  content: string;
  category: string;
  metadata: Record<string, unknown>;
}

export interface VerticalKnowledgeRow {
  scope: 'vertical';
  vertical_id: string;
  business_id: null;
  source_key: string;
  title: string;
  content: string;
  category: string;
  metadata: Record<string, unknown>;
  embedding_model: string;
  embedding: number[];
  content_hash: string;
  chunk_index: number;
}

export function buildVerticalKnowledgeRows(
  verticalId: string,
  chunks: readonly KnowledgeSeedChunk[],
  embeddings: readonly number[][],
): VerticalKnowledgeRow[] {
  const normalizedVerticalId = verticalId.trim();

  if (!normalizedVerticalId) {
    throw new Error('Vertical knowledge ingestion requires a vertical id');
  }

  if (chunks.length !== embeddings.length) {
    throw new Error(
      `Expected ${chunks.length} embeddings, got ${embeddings.length}`,
    );
  }

  return chunks.map((chunk, index) => {
    const embedding = embeddings[index];

    if (embedding.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(
        `Embedding ${index} has ${embedding.length} dimensions; expected ${EMBEDDING_DIMENSIONS}`,
      );
    }

    const content = chunk.content.trim();

    return {
      scope: 'vertical',
      vertical_id: normalizedVerticalId,
      business_id: null,
      source_key: chunk.sourceKey.trim(),
      title: chunk.title.trim(),
      content,
      category: chunk.category.trim(),
      metadata: chunk.metadata,
      embedding_model: EMBEDDING_MODEL,
      embedding,
      content_hash: createHash('sha256')
        .update(content)
        .digest('hex'),
      chunk_index: 0,
    };
  });
}

type EmbedDocuments = (inputs: string[]) => Promise<number[][]>;

export async function ingestVerticalKnowledge(
  supabase: SupabaseClient,
  verticalId: string,
  chunks: readonly KnowledgeSeedChunk[],
  embedDocuments: EmbedDocuments = embedTexts,
): Promise<number> {
  const normalizedVerticalId = verticalId.trim();

  if (!normalizedVerticalId) {
    throw new Error('Vertical knowledge ingestion requires a vertical id');
  }

  if (chunks.length === 0) return 0;

  const embeddings = await embedDocuments(
    chunks.map((chunk) => chunk.content),
  );

  const rows = buildVerticalKnowledgeRows(
    normalizedVerticalId,
    chunks,
    embeddings,
  );

  const updatedAt = new Date().toISOString();
  const rowsForUpsert = rows.map((row) => ({
    ...row,
    updated_at: updatedAt,
  }));

  const { error } = await supabase
    .from('knowledge_chunks')
    .upsert(rowsForUpsert, {
      onConflict:
        'scope,vertical_id,business_id,source_key,chunk_index',
    });

  if (error) {
    throw new Error(`Knowledge ingestion failed: ${error.message}`);
  }

  return rows.length;
}
