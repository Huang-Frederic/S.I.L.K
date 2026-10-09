/** Messages exchanged with the embedding worker. */
import type { Lang } from '../../i18n';

export type EmbedRequest = { type: 'load'; model: string } | { type: 'embed'; id: number; texts: string[] };

export type EmbedResponse =
  | { type: 'progress'; fraction: number }
  | { type: 'ready' }
  | { type: 'error'; message: string }
  | { type: 'embedded'; id: number; data: Float32Array; dim: number }
  | { type: 'embed-error'; id: number; message: string };

/**
 * Sentence-embedding model used by the spider, per language (384 dimensions
 * each): English MiniLM (~23 MB quantized), and its multilingual cousin for
 * French (~118 MB, fetched once and then cached by the browser), which
 * ranks French titles far better than the English one does.
 */
export const MODEL_IDS: Record<Lang, string> = {
  en: 'Xenova/all-MiniLM-L6-v2',
  fr: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
};

/**
 * transformers.js, pinned. The self-contained build (ONNX runtime included) is
 * imported from jsDelivr at runtime instead of being bundled: the model
 * weights and WASM binaries come from CDNs anyway, and the game stays small.
 */
export const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/dist/transformers.min.js';
