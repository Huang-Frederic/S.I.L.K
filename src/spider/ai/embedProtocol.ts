/** Messages exchanged with the embedding worker. */

export type EmbedRequest = { type: 'load' } | { type: 'embed'; id: number; texts: string[] };

export type EmbedResponse =
  | { type: 'progress'; fraction: number }
  | { type: 'ready' }
  | { type: 'error'; message: string }
  | { type: 'embedded'; id: number; data: Float32Array; dim: number }
  | { type: 'embed-error'; id: number; message: string };

/** Sentence-embedding model used by the spider (384 dimensions, ~23 MB quantized). */
export const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';

/**
 * transformers.js, pinned. The self-contained build (ONNX runtime included) is
 * imported from jsDelivr at runtime instead of being bundled: the model
 * weights and WASM binaries come from CDNs anyway, and the game stays small.
 */
export const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/dist/transformers.min.js';
