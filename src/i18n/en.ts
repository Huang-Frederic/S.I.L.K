/**
 * English texts. This is the reference: every language provides the same
 * keys (the `Strings` type is this object's type).
 */
import type { RoastFacts, TauntEvent } from '../game/comedy';
import type { DifficultyId } from '../game/difficulty';
import type { DecisionReason } from '../spider/ai/types';
import type { LinkDamage } from '../stage/racerPane';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const count = (n: number) => n.toLocaleString('en-US');

export const en = {
  /** Name of the language, in itself (language picker). */
  name: 'English',
  short: 'EN',
  /** `lang` attribute of the page and of the articles. */
  htmlLang: 'en',
  numberLocale: 'en-US',

  title: {
    howLink: 'How it works',
    language: 'Language',
    kicker: 'Wikirace // you vs. a crawling spider',
    pitch:
      'Pick two Wikipedia pages. Click your way from one to the other while an AI spider crawls the same web, smashing words and diving into links. First one there wins.',
    foot: 'Article text from Wikipedia, CC BY-SA 4.0. Not affiliated with the Wikimedia Foundation.',
    reduceMotion: 'Reduce motion',
    hardWins: 'Hard mode wins: ',
    hardWinsHint: 'Counted in this browser only',
    start: { label: 'Start page', placeholder: 'e.g. Silk', dice: 'Random start page' },
    target: { label: 'Target page', placeholder: 'e.g. Pixel art', dice: 'Random target page' },
    startRace: 'Start race',
    checking: 'Checking…',
    randomPair: 'Random pair',
    rolling: 'Rolling a random article…',
    randomFailed: 'Could not reach Wikipedia for a random article. Type one instead.',
    difficulty: 'Spider difficulty',
  },

  how: {
    crawl: { title: 'How the spider crawls', sub: 'one hop = scan → crawl & eat → grab → hop · loops until target' },
    steps: {
      scan: ['scan', 'Lands on a page and fires a ray at every link to score it: direct hit, links back to the target, or closest in meaning.'],
      crawl: [
        'crawl & eat',
        'Weaves over the real text toward the link like a snake, across the whole column on a long way. Each foot grabs a word (cyan box), and may tear it up when it lets go.',
      ],
      grab: ['grab', 'Reaches the link and wraps all eight legs around it. The link lights up and the page edges start to glitch.'],
      hop: ['hop', 'The old page glitches out in RGB-split slices, the next article loads, and the spider drops in on its silk thread.'],
    },
    moves: { title: 'Spider move set', sub: 'simple body, flashy moves · triggered at random while it crawls' },
    moveCards: {
      laser: ['eye laser', 'Fires from the red eye to lock the next link, and slices words in half on the way. Sparks at the cut.'],
      throw: ['grab & throw', 'A front leg plucks a word out of the text and flings it off the page, spinning. It leaves a dashed hole behind.'],
      stomp: ['stomp', 'Slams a foot onto a short word: impact rings, a small screen shake, and the word cracks and falls apart.'],
      zip: [
        'web zip',
        'Now and then, for a link a few lines away, it shoots a silk line at it and zips there in one move. A long way, it goes on foot, bounding forward, and shoots silk further down to zip ahead, but never right onto the link: it is there within 40 s.',
      ],
    },
    levels: { title: 'Difficulty', sub: 'same brain on every level · only its manners change' },
    levelLines: {
      easy: ['Slow thinker.', 'Only crawls and tears up its own page.', 'Never attacks you.', 'Winnable.'],
      normal: [
        'The default. It runs.',
        'Web traps, a fan laser that burns every word it sweeps, word bombardments.',
        'About one attack every 25 s, faster in rage (when your page links to the target).',
        'Hard but winnable.',
      ],
      hard: [
        'Tears the page apart as it goes, and fumbles a little for the right link; rage always on.',
        'An attack every 4–8 s, chained, no warning: webs, fan lasers, word bombs, fake target links that hatch mini-spiders (they wander about your page, slowly breaking everything), and now and then a silk line on your cursor.',
        'Get ahead and it steals the good link you click (never your first three, never the last two before the target, at most one a minute): it leaps across, eats it, dives in, and the panes swap.',
        'Expected win rate: almost zero.',
      ],
    } satisfies Record<DifficultyId, string[]>,
  },

  difficulties: {
    easy: { label: 'Easy', blurb: 'It only crawls and eats its own page. Slow thinker. Never touches you. Winnable.' },
    normal: { label: 'Normal', blurb: 'It runs. Web traps, fan lasers and word bombs, about every 25 s. Hard but winnable.' },
    hard: {
      label: 'Hard',
      blurb: 'Everything, every few seconds, no warning. It tears the page apart. Get ahead and it steals your good links. Expected win rate: almost zero.',
    },
  } satisfies Record<DifficultyId, { label: string; blurb: string }>,

  pairs: {
    noStart: 'Choose a start article.',
    noTarget: 'Choose a target article.',
    offline: 'Wikipedia could not be reached. Check your connection and try again.',
    missing: (title: string) => `No English Wikipedia article is called “${title}”.`,
    disambiguation: (title: string) => `“${title}” is a disambiguation page. Pick a more specific article.`,
    same: 'The target must be a different article from the start.',
  },

  article: {
    subtitle: 'From Wikipedia, the free encyclopedia',
    redirected: (from: string) => `(Redirected from ${from})`,
    disambiguation: 'This is a disambiguation page: it lists articles that share a similar title.',
    attribution: (title: string) => ['Text from the Wikipedia article “', title, '” (', 'authors', '), available under ', '. Shown in simplified form: images, references and navigation boxes were removed.'],
  },

  pane: {
    you: 'YOU',
    spider: 'SPIDER',
    hops: 'hops ',
    back: '← back',
    backHint: 'Previous article (counts as a hop)',
    reasoning: "The spider's current reasoning",
    yourArticle: 'Your article',
    spiderArticle: "The spider's article",
    textFrom: 'Text from Wikipedia, ',
    viewOriginal: 'View original',
    authors: 'authors',
    wordsEaten: (n: number) => ` · words eaten: ${count(n)}`,
  },

  race: {
    target: 'Target',
    giveUp: 'Give up',
    clock: 'Race time',
    boot: 'crawler.boot()',
    checklist: ['Start article', 'Target backlinks', "Spider's brain"],
    pending: 'loading…',
    linkingPages: (n: number) => `${count(n)} pages link to it`,
    noBacklinks: 'unavailable, similarity only',
    modelLoading: (percent: number) => `loading model ${percent}%`,
    modelReady: 'semantic ranking (MiniLM)',
    modelFailed: 'word matching (model unavailable)',
    modelLater: 'word matching until the model is ready',
    startFailed: (message: string) => `Could not load the start article: ${message}`,
    retry: 'Retry',
    back: 'Back',
    dismiss: 'Dismiss',
    go: 'GO',
    hoverHop: (hop: number, title: string) => `hop ${hop} → ${title}`,
    hoverBlocked: (damage: LinkDamage | null) => `blocked · ${damage ?? 'damaged'}`,
    loading: (title: string) => `Loading “${title}”…`,
    stillLoading: (title: string) => `Still loading “${title}”… Wikipedia may be busy, retrying.`,
    gone: (title: string) => `“${title}” does not exist on Wikipedia (it may have been deleted). Pick another link.`,
    loadFailed: (title: string, message: string) => `Could not load “${title}”: ${message}`,
    fakeLink: 'Fake link! Mini-spiders are breaking up your page.',
    swapped: 'The spider stole your link. The panes swapped: you continue from its page.',
    spiderGaveUp: 'The spider gave up.',
    spiderSays: (line: string) => `Spider: ${line}`,
    brainStart: (target: string, backlinks: number) =>
      `SPIDER.BRAIN · target = "${target}" · ${backlinks ? `${count(backlinks)} pages link to it` : 'no backlinks, similarity only'}`,
    brain: (links: number, target: string, wordMatching: boolean) =>
      `SPIDER.BRAIN · ${count(links)} links scored · target = "${target}"${wordMatching ? ' · word matching' : ''}`,
    tagTarget: 'target ✓',
    tagBacklink: 'backlink ✓',
  },

  /** The spider's status line (code-like lines stay as they are). */
  spider: {
    scanning: (links: number) => `scanning ${count(links)} links…`,
    no: (name: string) => `${name}? no.`,
    hmm: 'hmm…',
    hop: (hops: number) => `+1 HOP · hops: ${hops}`,
    crashed: 'crashed into a network error',
    exhausted: 'exhausted: too many hops',
    trapped: 'trapped: no way out of this page',
    deadEnd: 'dead_end · climbing back up the thread',
    gone: (title: string) => `"${title}" is gone · rethinking`,
    retrying: 'network hiccup · retrying',
    burned: (words: number) => `eye.laser.fan() · ${count(words)} words burned`,
    decoy: 'plant(decoy) · trust me',
    reasons: { target: 'direct hit', backlink: 'backlink', semantic: 'closest', lexical: 'words', 'dead-end': undefined } satisfies Record<
      DecisionReason,
      string | undefined
    >,
  },

  taunts: {
    start: ['let’s dance.', 'eight legs. zero chill.', 'catch me if you can.'],
    hop: ['+1.', 'keep up.', 'next.', 'too easy.'],
    snatch: ['mine now.', 'nom.', 'yoink.', 'thanks for the link.'],
    'player-near-target': ['you were so close.', 'don’t even think about it.'],
    web: ['stuck?', 'sticky situation.'],
    laser: ['pew.', 'denied.', 'everything burns.', 'crispy.'],
    bombard: ['incoming.', 'catch.', 'have some words.'],
    'decoy-planted': ['click me.', 'trust me.'],
    'decoy-clicked': ['gotcha.', 'say hi to the kids.', 'they’re hungry.', 'that was a nest.'],
    harass: ['let me help.', 'this way.', 'wrong way.'],
    'blocked-click': ['skill issue.', 'nope.'],
    'player-slow': ['too slow.', 'tick tock.', 'reading the whole thing?'],
    'player-hop': ['cute.', 'too slow.'],
    'give-up': ['skill issue.', 'gg no re.'],
    'spider-wins': ['gg.', 'too slow.', 'skill issue.'],
    'spider-loses': ['impossible.', 'this never happened.'],
  } satisfies Record<TauntEvent, string[]>,

  /** Lose-screen roast lines, built from real numbers of the race. */
  roasts: (facts: RoastFacts): string[] => {
    const lines = [
      `The spider ate ${count(facts.wordsEaten)} word${facts.wordsEaten === 1 ? '' : 's'} and your dignity.`,
      '8 legs, 1 eye, 0 mercy.',
      'Maybe try Easy. Or don’t.',
      'It didn’t even need all eight legs.',
      `${plural(facts.spiderHops, 'hop')}. Zero hesitation.`,
      'The spider would like to thank your cursor.',
    ];
    if (facts.difficulty === 'easy') lines.push('Lost on Easy. The spider is telling everyone.');
    if (facts.difficulty === 'hard') lines.push('You were so close. (You weren’t.)');
    if (facts.decoysClicked > 0) lines.push('You clicked a fake link. The babies say thanks.');
    if (facts.snatched) lines.push('It stole your best link. And your race.');
    return lines;
  },
  giveUpRoasts: ['Rage quit detected.', 'The spider respects the honesty. Not you, though.', 'Skill issue, says the spider.'],

  finish: {
    beatBy: (hops: number) => `You beat the spider by ${plural(hops, 'hop')}.`,
    beatEven: 'You beat the spider in as many hops.',
    beatDespite: (hops: number) => `You beat the spider, even with ${plural(hops, 'more hop')}.`,
    spiderRetired: ' The spider gave up.',
    spiderOneAway: ' It was one link away from the target.',
    spiderCrawling: ' It was still crawling.',
    impossible: 'IMPOSSIBLE.',
    screenshot: '(screenshot this.)',
    hardWins: (wins: number) => ` Hard mode wins in this browser: ${wins}.`,
    win: 'You win.',
    gaveUp: 'You gave up.',
    lose: 'Spider wins.',
    nobody: 'Nobody made it.',
    nobodyDetail: 'Both of you gave up on this one.',
    status: { impossible: 'deceased', win: 'defeated', 'gave-up': 'smug', lose: 'victorious', nobody: 'stuck' },
    you: 'You',
    spider: 'Spider',
    hops: (n: number) => plural(n, 'hop'),
    complete: 'Race complete',
    stats: 'Stats',
    yourTime: 'Your time',
    spiderTime: 'Spider time',
    raceTime: 'Race time',
    yourHops: 'Your hops',
    spiderHops: 'Spider hops',
    wordsEaten: 'Words eaten',
    yourPath: 'Your path',
    spiderPath: "Spider's path",
    rematch: 'Rematch',
    newPair: 'New pair',
    copy: 'Copy both paths',
    copied: 'Copied',
    copyFailed: 'Copy failed',
    foot: 'Article text from Wikipedia, CC BY-SA 4.0. ',
    source: 'Source code',
    tags: { snatch: 'snatched', 'dead-end': 'backtrack', swap: 'swapped', back: 'back' } as Record<string, string>,
  },

  errors: {
    network: 'Wikipedia could not be reached',
    http: (status: number) => `Wikipedia answered with an error (HTTP ${status})`,
    missing: (title: string) => `The article “${title}” does not exist on English Wikipedia.`,
  },

  demo: {
    text: [
      'A ',
      { strong: 'web crawler' },
      ' is a program that visits a page, reads its links and follows them, one hop at a time. Search engines use crawlers to map the web, archives use them to keep it, and this one uses them to beat you. It reads every link on the page, picks the one closest to the target, and crawls straight to it.',
    ] as Array<string | { strong: string }>,
    live: 'live · crawler.demo',
    states: { boot: 'BOOTING', scan: 'SCANNING', lock: 'LOCKED', crawl: 'CRAWLING', eat: 'EATING' },
  },

  /** Words drawn in the "How it works" illustrations. */
  art: {
    scanning: 'scanning 38 links…',
    backlink: '0.82 backlink',
    locked: 'LOCKED · raster_graphics',
    hop: '+1 HOP · hops: 7',
    title: 'Raster graphics',
    cut: ['appr', 'oach'],
    carried: 'colour',
    thrown: 'scenes',
    link: 'raster graphics',
  },
};

export type Strings = typeof en;
