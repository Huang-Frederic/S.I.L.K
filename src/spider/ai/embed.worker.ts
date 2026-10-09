/**
 * Web Worker running the sentence-embedding model with transformers.js, so
 * that inference never stalls the spider's animation on the main thread.
 */
import { TRANSFORMERS_URL, type EmbedRequest, type EmbedResponse } from './embedProtocol';

interface Tensor {
  data: Float32Array | number[];
  dims: number[];
}

type FeatureExtractor = (texts: string[], options: { pooling: 'mean'; normalize: boolean }) => Promise<Tensor>;

interface ProgressInfo {
  status: string;
  file?: string;
  loaded?: number;
  total?: number;
}

/** The small part of the transformers.js API we use. */
interface Transformers {
  env: { allowLocalModels: boolean };
  pipeline(
    task: 'feature-extraction',
    model: string,
    options: { dtype?: string; progress_callback?: (info: ProgressInfo) => void },
  ): Promise<FeatureExtractor>;
}

// Typed view of the worker global scope (the DOM lib types `self` as Window).
const scope = self as unknown as {
  postMessage(message: EmbedResponse, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<EmbedRequest>) => void) | null;
};

let extractor: Promise<FeatureExtractor> | null = null;
/** The model this worker runs (set by the first `load` message). */
let model = '';

function load(): Promise<FeatureExtractor> {
  extractor ??= (async () => {
    const transformers = (await import(/* @vite-ignore */ TRANSFORMERS_URL)) as Transformers;
    transformers.env.allowLocalModels = false;
    // Aggregate per-file download progress into one fraction.
    const files = new Map<string, { loaded: number; total: number }>();
    return transformers.pipeline('feature-extraction', model, {
      dtype: 'q8',
      progress_callback: (info) => {
        if (info.status !== 'progress' || !info.file || !info.total) return;
        files.set(info.file, { loaded: info.loaded ?? 0, total: info.total });
        let loaded = 0;
        let total = 0;
        for (const file of files.values()) {
          loaded += file.loaded;
          total += file.total;
        }
        scope.postMessage({ type: 'progress', fraction: total ? loaded / total : 0 });
      },
    });
  })();
  extractor.catch(() => (extractor = null));
  return extractor;
}

scope.onmessage = async (event) => {
  const request = event.data;
  if (request.type === 'load') {
    model ||= request.model;
    try {
      await load();
      scope.postMessage({ type: 'ready' });
    } catch (error) {
      scope.postMessage({ type: 'error', message: String(error) });
    }
    return;
  }
  try {
    const run = await load();
    const output = await run(request.texts, { pooling: 'mean', normalize: true });
    // Copy: the tensor may be a view on WASM memory, which must not be transferred.
    const data = Float32Array.from(output.data);
    const dim = output.dims[output.dims.length - 1];
    scope.postMessage({ type: 'embedded', id: request.id, data, dim }, [data.buffer]);
  } catch (error) {
    scope.postMessage({ type: 'embed-error', id: request.id, message: String(error) });
  }
};
