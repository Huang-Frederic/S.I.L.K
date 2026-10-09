/**
 * S.I.L.K (Spider Indexing Links & Knowledge)
 * Entry point: wires the Wikipedia client and the spider's brain, and
 * switches between screens.
 */
import './styles/base.css';
import './styles/article.css';
import './styles/screens.css';

import { DEFAULT_DIFFICULTY, DIFFICULTIES } from './game/difficulty';
import type { ValidatedPair } from './game/pairs';
import { LexicalRanker } from './spider/ai/lexical';
import { FallbackRanker, SemanticRanker } from './spider/ai/semantic';
import { WorkerEmbedder } from './spider/ai/workerEmbedder';
import { RaceScreen } from './ui/raceScreen';
import { createSetupScreen } from './ui/setupScreen';
import { ArticleStore } from './wiki/articles';
import { WikiClient } from './wiki/client';

const app = document.getElementById('app')!;
const client = new WikiClient();
const store = new ArticleStore(client);

// The embedding model is shared by every race: it loads in the background
// (a Web Worker) as soon as the game opens, and its vectors stay cached.
const embedder = new WorkerEmbedder();
const ranker = new FallbackRanker(new SemanticRanker(embedder), new LexicalRanker());
embedder.load().catch(() => {
  // The spider falls back to lexical ranking; the HUD badge says so.
});

let currentRace: RaceScreen | null = null;
let lastPair: ValidatedPair | null = null;

function showSetup(): void {
  currentRace?.destroy();
  currentRace = null;
  app.replaceChildren(
    createSetupScreen({
      client,
      initialStart: lastPair?.start.title,
      initialTarget: lastPair?.target.title,
      onStart: ({ pair }) => startRace(pair),
    }),
  );
}

function startRace(pair: ValidatedPair): void {
  lastPair = pair;
  currentRace?.destroy();
  const race = new RaceScreen({
    client,
    store,
    ranker,
    embedder,
    pair,
    difficulty: DIFFICULTIES[DEFAULT_DIFFICULTY],
    onExit: showSetup,
    onRematch: () => startRace(pair),
  });
  currentRace = race;
  app.replaceChildren(race.element);
  void race.begin();
}

showSetup();
