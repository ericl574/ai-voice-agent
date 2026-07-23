// scripts/try-embeddings.ts — a one-off to watch embeddings + cosine similarity work.
import { embedText, EMBEDDING_DIMENSIONS } from '@/lib/knowledge/embeddings';

// Cosine similarity: dot(x,y) / (|x|·|y|). 1.0 = same meaning, ~0 = unrelated.
function cosine(x: number[], y: number[]): number {
  let dot = 0, nx = 0, ny = 0;
  for (let i = 0; i < x.length; i++) {
    dot += x[i] * y[i];
    nx += x[i] * x[i];
    ny += y[i] * y[i];
  }
  return dot / (Math.sqrt(nx) * Math.sqrt(ny));
}

async function main() {
  const brakes = await embedText('my brakes feel soft and the car takes longer to stop');
  const halt   = await embedText('the vehicle needs a lot more distance before it comes to a halt');
  const cakes  = await embedText('do you sell birthday cakes for a party this weekend');

  console.log('dimensions:', brakes.length, '(expected', EMBEDDING_DIMENSIONS + ')');
  console.log('brakes  ↔  "more distance to halt" :', cosine(brakes, halt).toFixed(3));
  console.log('brakes  ↔  "birthday cakes"        :', cosine(brakes, cakes).toFixed(3));
}

main().catch((e) => { console.error(e); process.exit(1); });