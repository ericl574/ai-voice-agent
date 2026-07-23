// src/lib/knowledge/embeddings.ts
//
// Turns text into embedding vectors via OpenAI's REST API (no SDK dependency).
// This is the SINGLE place the embedding model is chosen. Ingestion (embedding
// documents) and search (embedding the caller's question) both import from here,
// so the two paths can NEVER drift to different models — which would make their
// vectors incomparable and silently break retrieval.
//
// Server-only: reads OPENAI_API_KEY. Never import this into browser/client code.

const OPENAI_EMBEDDINGS_URL = 'https://api.openai.com/v1/embeddings';

// MUST match knowledge_chunks.embedding vector(1536) and the column's
// embedding_model default. Change one, change all three.
export const EMBEDDING_MODEL = 'text-embedding-3-small';
export const EMBEDDING_DIMENSIONS = 1536;

interface OpenAIEmbeddingResponse {
  data: { index: number; embedding: number[] }[];
  model: string;
  usage: { prompt_tokens: number; total_tokens: number };
}

// Embed a batch of strings in ONE API call. Returns vectors in the SAME order as
// `inputs`. Batching matters: ingestion embeds many chunks at once, and one request
// is far cheaper and faster than N separate ones.
export async function embedTexts(inputs: string[]): Promise<number[][]> {
  if (inputs.length === 0) return [];

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set — embeddings require a server-side OpenAI key.');
  }

  // The API rejects empty strings; guard so one bad chunk can't fail the whole batch.
  const cleaned = inputs.map((t) => t.trim());
  if (cleaned.some((t) => t.length === 0)) {
    throw new Error('embedTexts received an empty string — check your chunking.');
  }

  const res = await fetch(OPENAI_EMBEDDINGS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: cleaned }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI embeddings failed (${res.status}): ${body}`);
  }

  const json = (await res.json()) as OpenAIEmbeddingResponse;

  // Defensive: the API returns one item per input. Sort by `index` so the output
  // order is guaranteed to line up with `inputs`, no matter the response order.
  const ordered = [...json.data].sort((a, b) => a.index - b.index);
  if (ordered.length !== cleaned.length) {
    throw new Error(`Expected ${cleaned.length} embeddings, got ${ordered.length}.`);
  }

  return ordered.map((d) => d.embedding);
}

// Convenience wrapper for the single-string case (query-time search).
export async function embedText(input: string): Promise<number[]> {
  const [vector] = await embedTexts([input]);
  return vector;
}