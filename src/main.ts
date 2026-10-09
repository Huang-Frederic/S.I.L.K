/**
 * S.I.L.K (Spider Indexing Links & Knowledge)
 * Entry point: wires the Wikipedia client and the spider's brain, and
 * switches between the title, race and finish screens.
 */
import './styles/base.css';
import './styles/article.css';
import './styles/screens.css';

import { DEFAULT_DIFFICULTY, DIFFICULTIES, type DifficultyId } from './game/difficulty';
import type { ValidatedPair } from './game/pairs';
import { settings } from './settings';
import { LexicalRanker } from './spider/ai/lexical';
import { FallbackRanker, SemanticRanker } from './spider/ai/semantic';
import { WorkerEmbedder } from './spider/ai/workerEmbedder';
import { createFinishScreen } from './ui/finishScreen';
import { RaceScreen, type RaceResult } from './ui/raceScreen';
import { createTitleScreen, type TitleScreen } from './ui/titleScreen';
import { ArticleStore } from './wiki/articles';
import { WikiClient } from './wiki/client';

const app = document.getElementById('app')!;
const client = new WikiClient();
const store = new ArticleStore(client);

// The embedding model is shared by every race: it loads in the background
// (in a Web Worker) as soon as the game opens, and its vectors stay cached.
const embedder = new WorkerEmbedder();
const ranker = new FallbackRanker(new SemanticRanker(embedder), new LexicalRanker());
embedder.load().catch(() => {
  // The spider falls back to word matching; its brain panel says so.
});

let currentRace: RaceScreen | null = null;
let currentTitle: TitleScreen | null = null;
let lastPair: ValidatedPair | null = null;
/** The game opens on Normal; the choice then holds for rematches and new pairs. */
let difficulty: DifficultyId = DEFAULT_DIFFICULTY;

// Reduce motion is applied as a class so that CSS transitions can follow it.
const applyMotion = () => document.documentElement.classList.toggle('reduce-motion', settings.reduceMotion);
settings.onChange(applyMotion);
applyMotion();

function clear(): void {
  currentRace?.destroy();
  currentRace = null;
  currentTitle?.destroy();
  currentTitle = null;
}

function showTitle(): void {
  clear();
  const title = createTitleScreen({
    client,
    initialStart: lastPair?.start.title,
    initialTarget: lastPair?.target.title,
    initialDifficulty: difficulty,
    onStart: (choice) => {
      difficulty = choice.difficulty;
      startRace(choice.pair);
    },
  });
  currentTitle = title;
  app.replaceChildren(title.element);
  window.scrollTo(0, 0);
  title.mount();
}

function startRace(pair: ValidatedPair): void {
  clear();
  lastPair = pair;
  const race = new RaceScreen({
    client,
    store,
    ranker,
    embedder,
    pair,
    difficulty: DIFFICULTIES[difficulty],
    onExit: showTitle,
    onFinish: showFinish,
  });
  currentRace = race;
  app.replaceChildren(race.element);
  window.scrollTo(0, 0);
  void race.begin();
}

function showFinish(result: RaceResult): void {
  clear();
  app.replaceChildren(
    createFinishScreen({
      result,
      onRematch: () => startRace(result.pair),
      onNewPair: showTitle,
    }),
  );
  window.scrollTo(0, 0);
}

showTitle();
