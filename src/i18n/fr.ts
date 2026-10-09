/** Textes en français (mêmes clés que l’anglais, voir en.ts). */
import type { RoastFacts } from '../game/comedy';
import type { LinkDamage } from '../stage/racerPane';
import type { Strings } from './en';

/** En français, 0 et 1 restent au singulier. */
const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;
const count = (n: number) => n.toLocaleString('fr-FR');
const DAMAGE: Record<LinkDamage, string> = { webbed: 'pris dans la toile', covered: 'recouvert', burned: 'brûlé', eaten: 'dévoré' };

export const fr: Strings = {
  name: 'Français',
  short: 'FR',
  htmlLang: 'fr',
  numberLocale: 'fr-FR',

  title: {
    howLink: 'Comment ça marche',
    language: 'Langue',
    kicker: 'Wikirace // toi contre une araignée qui rampe',
    pitch:
      'Choisis deux pages Wikipédia. Va de l’une à l’autre de lien en lien pendant qu’une araignée IA parcourt la même toile, écrase les mots et plonge dans les liens. Le premier arrivé gagne.',
    foot: 'Texte des articles : Wikipédia, CC BY-SA 4.0. Sans lien avec la Wikimedia Foundation.',
    reduceMotion: 'Réduire les animations',
    hardWins: 'Victoires en Difficile : ',
    hardWinsHint: 'Comptées dans ce navigateur uniquement',
    start: { label: 'Page de départ', placeholder: 'ex. Soie', dice: 'Page de départ au hasard' },
    target: { label: 'Page cible', placeholder: 'ex. Pixel art', dice: 'Page cible au hasard' },
    startRace: 'Lancer la course',
    checking: 'Vérification…',
    randomPair: 'Paire au hasard',
    rolling: 'Tirage d’un article au hasard…',
    randomFailed: 'Wikipédia ne répond pas pour un article au hasard. Tape un titre à la place.',
    difficulty: 'Difficulté de l’araignée',
  },

  how: {
    crawl: { title: 'Comment l’araignée rampe', sub: 'un saut = scan → rampe & dévore → saisit → saute · en boucle jusqu’à la cible' },
    steps: {
      scan: ['scan', 'Atterrit sur une page et tire un rayon sur chaque lien pour le noter : la cible elle-même, un lien qui mène à la cible, ou le plus proche par le sens.'],
      crawl: [
        'rampe & dévore',
        'Ondule sur le vrai texte jusqu’au lien comme un serpent, d’un bord à l’autre de la colonne quand c’est loin. Chaque patte agrippe un mot (cadre cyan), et peut le déchirer en le lâchant.',
      ],
      grab: ['saisit', 'Atteint le lien et l’enserre de ses huit pattes. Le lien s’allume et les bords de la page se mettent à glitcher.'],
      hop: ['saute', 'L’ancienne page se désagrège en tranches RVB décalées, l’article suivant se charge, et l’araignée descend au bout de son fil.'],
    },
    moves: { title: 'Les coups de l’araignée', sub: 'corps simple, coups spectaculaires · au hasard pendant qu’elle rampe' },
    moveCards: {
      laser: ['laser oculaire', 'Tiré depuis l’œil rouge pour verrouiller le prochain lien, il coupe les mots en deux au passage. Étincelles à la coupure.'],
      throw: ['attrape & lance', 'Une patte avant arrache un mot du texte et le jette hors de la page en le faisant tournoyer. Il laisse un trou en pointillés.'],
      stomp: ['écrase', 'Frappe un mot court du pied : onde de choc, petite secousse de l’écran, et le mot se fissure et tombe en morceaux.'],
      zip: [
        'tyrolienne',
        'De temps en temps, pour un lien à quelques lignes, elle tire un fil de soie dessus et y file d’un coup. Quand c’est loin, elle y va à pied en bondissant, et tire sa soie plus bas pour avancer plus vite, mais jamais pile sur le lien : elle y est en moins de 40\u00a0s.',
      ],
    },
    levels: { title: 'Difficulté', sub: 'même cerveau à tous les niveaux · seules ses manières changent' },
    levelLines: {
      easy: ['Réfléchit lentement.', 'Se contente de ramper et de déchirer sa propre page.', 'Ne t’attaque jamais.', 'Gagnable.'],
      normal: [
        'Le mode par défaut. Elle court.',
        'Toiles pièges, laser en éventail qui brûle chaque mot qu’il balaie, bombardements de mots.',
        'Environ une attaque toutes les 25\u00a0s, plus souvent en rage (quand ta page mène à la cible).',
        'Difficile mais gagnable.',
      ],
      hard: [
        'Met la page en pièces sur son passage, et cherche un peu le bon lien ; rage permanente.',
        'Une attaque toutes les 4 à 8\u00a0s, en chaîne, sans prévenir : toiles, lasers en éventail, bombes de mots, faux liens vers la cible d’où sortent des bébés araignées (ils errent sur ta page et cassent tout, lentement), et parfois un fil de soie collé à ton curseur.',
        'Prends de l’avance et elle te vole le bon lien sur lequel tu cliques (jamais tes trois premiers, jamais les deux derniers avant la cible, au plus un par minute) : elle bondit, le dévore, plonge dedans, et les panneaux s’échangent.',
        'Taux de victoire attendu : presque zéro.',
      ],
    },
  },

  difficulties: {
    easy: { label: 'Facile', blurb: 'Elle se contente de ramper et de dévorer sa propre page. Réfléchit lentement. Ne te touche jamais. Gagnable.' },
    normal: { label: 'Normal', blurb: 'Elle court. Toiles pièges, lasers en éventail et bombes de mots, environ toutes les 25\u00a0s. Difficile mais gagnable.' },
    hard: {
      label: 'Difficile',
      blurb: 'Tout, toutes les quelques secondes, sans prévenir. Elle met la page en pièces. Prends de l’avance et elle te vole tes bons liens. Taux de victoire attendu : presque zéro.',
    },
  },

  pairs: {
    noStart: 'Choisis un article de départ.',
    noTarget: 'Choisis un article cible.',
    offline: 'Impossible de joindre Wikipédia. Vérifie ta connexion et réessaie.',
    missing: (title) => `Aucun article de Wikipédia en français ne s’appelle « ${title} ».`,
    disambiguation: (title) => `« ${title} » est une page d’homonymie. Choisis un article plus précis.`,
    same: 'La cible doit être un autre article que le départ.',
  },

  article: {
    subtitle: 'Un article de Wikipédia, l’encyclopédie libre',
    redirected: (from) => `(Redirigé depuis ${from})`,
    disambiguation: 'Ceci est une page d’homonymie : elle liste des articles aux titres proches.',
    attribution: (title) => [
      'Texte de l’article Wikipédia « ',
      title,
      ' » (',
      'auteurs',
      '), disponible sous licence ',
      '. Affiché sous forme simplifiée : images, références et boîtes de navigation ont été retirées.',
    ],
  },

  pane: {
    you: 'TOI',
    spider: 'ARAIGNÉE',
    hops: 'sauts ',
    back: '← retour',
    backHint: 'Article précédent (compte comme un saut)',
    reasoning: 'Le raisonnement actuel de l’araignée',
    yourArticle: 'Ton article',
    spiderArticle: 'L’article de l’araignée',
    textFrom: 'Texte de Wikipédia, ',
    viewOriginal: 'Voir l’original',
    authors: 'auteurs',
    wordsEaten: (n) => ` · mots dévorés : ${count(n)}`,
  },

  race: {
    target: 'Cible',
    giveUp: 'Abandonner',
    clock: 'Temps de course',
    boot: 'crawler.boot()',
    checklist: ['Article de départ', 'Backlinks de la cible', 'Cerveau de l’araignée'],
    pending: 'chargement…',
    linkingPages: (n) => `${count(n)} pages y mènent`,
    noBacklinks: 'indisponibles, similarité seule',
    modelLoading: (percent) => `chargement du modèle ${percent} %`,
    modelReady: 'classement sémantique (MiniLM multilingue)',
    modelFailed: 'correspondance de mots (modèle indisponible)',
    modelLater: 'correspondance de mots en attendant le modèle',
    startFailed: (message) => `Impossible de charger l’article de départ : ${message}`,
    retry: 'Réessayer',
    back: 'Retour',
    dismiss: 'Fermer',
    go: 'GO',
    hoverHop: (hop, title) => `saut ${hop} → ${title}`,
    hoverBlocked: (damage) => `bloqué · ${damage ? DAMAGE[damage] : 'abîmé'}`,
    loading: (title) => `Chargement de « ${title} »…`,
    stillLoading: (title) => `« ${title} » se fait attendre… Wikipédia est peut-être occupé, nouvel essai.`,
    gone: (title) => `« ${title} » n’existe pas sur Wikipédia (il a peut-être été supprimé). Choisis un autre lien.`,
    loadFailed: (title, message) => `Impossible de charger « ${title} » : ${message}`,
    fakeLink: 'Faux lien ! Des bébés araignées cassent ta page.',
    swapped: 'L’araignée t’a volé ton lien. Les panneaux s’échangent : tu repars de sa page.',
    spiderGaveUp: 'L’araignée abandonne.',
    spiderSays: (line) => `Araignée : ${line}`,
    brainStart: (target, backlinks) =>
      `SPIDER.BRAIN · cible = « ${target} » · ${backlinks ? `${count(backlinks)} pages y mènent` : 'pas de backlinks, similarité seule'}`,
    brain: (links, target, wordMatching) => `SPIDER.BRAIN · ${count(links)} liens notés · cible = « ${target} »${wordMatching ? ' · correspondance de mots' : ''}`,
    tagTarget: 'cible ✓',
    tagBacklink: 'backlink ✓',
  },

  spider: {
    scanning: (links) => `analyse de ${count(links)} liens…`,
    no: (name) => `${name} ? non.`,
    hmm: 'hmm…',
    hop: (hops) => `+1 SAUT · sauts : ${hops}`,
    crashed: 'plantée par une erreur réseau',
    exhausted: 'épuisée : trop de sauts',
    trapped: 'piégée : aucune sortie sur cette page',
    deadEnd: 'cul_de_sac · remonte le long du fil',
    gone: (title) => `« ${title} » a disparu · réfléchit encore`,
    retrying: 'hoquet réseau · nouvel essai',
    burned: (words) => `eye.laser.fan() · ${count(words)} mots brûlés`,
    decoy: 'plant(decoy) · fais-moi confiance',
    reasons: { target: 'cible directe', backlink: 'backlink', semantic: 'le plus proche', lexical: 'mots', 'dead-end': undefined },
  },

  taunts: {
    start: ['on danse ?', 'huit pattes. zéro pitié.', 'attrape-moi si tu peux.'],
    hop: ['+1.', 'suis le rythme.', 'suivant.', 'trop facile.'],
    snatch: ['à moi.', 'miam.', 'hop, volé.', 'merci pour le lien.'],
    'player-near-target': ['t’y étais presque.', 'n’y pense même pas.'],
    web: ['coincé ?', 'ça colle, hein ?'],
    laser: ['piou.', 'refusé.', 'tout brûle.', 'bien grillé.'],
    bombard: ['attention.', 'attrape.', 'tiens, des mots.'],
    'decoy-planted': ['clique-moi.', 'fais-moi confiance.'],
    'decoy-clicked': ['eh oui.', 'dis bonjour aux petits.', 'ils ont faim.', 'c’était un nid.'],
    harass: ['je t’aide.', 'par ici.', 'mauvais chemin.'],
    'blocked-click': ['manque de skill.', 'nope.'],
    'player-slow': ['trop lent.', 'tic tac.', 'tu lis tout l’article ?'],
    'player-hop': ['mignon.', 'trop lent.'],
    'give-up': ['manque de skill.', 'gg no re.'],
    'spider-wins': ['gg.', 'trop lent.', 'manque de skill.'],
    'spider-loses': ['impossible.', 'ça ne s’est jamais passé.'],
  },

  roasts: (facts: RoastFacts) => {
    const lines = [
      `L’araignée a dévoré ${count(facts.wordsEaten)} mot${facts.wordsEaten > 1 ? 's' : ''} et ta dignité.`,
      '8 pattes, 1 œil, 0 pitié.',
      'Essaie peut-être Facile. Ou pas.',
      'Elle n’a même pas eu besoin de ses huit pattes.',
      `${plural(facts.spiderHops, 'saut')}. Zéro hésitation.`,
      'L’araignée tient à remercier ton curseur.',
    ];
    if (facts.difficulty === 'easy') lines.push('Perdu en Facile. L’araignée le raconte à tout le monde.');
    if (facts.difficulty === 'hard') lines.push('T’y étais presque. (Non.)');
    if (facts.decoysClicked > 0) lines.push('Tu as cliqué sur un faux lien. Les bébés te remercient.');
    if (facts.snatched) lines.push('Elle t’a volé ton meilleur lien. Et ta course.');
    return lines;
  },
  giveUpRoasts: ['Rage quit détecté.', 'L’araignée respecte ton honnêteté. Pas toi, par contre.', 'Manque de skill, dit l’araignée.'],

  finish: {
    beatBy: (hops) => `Tu bats l’araignée de ${plural(hops, 'saut')}.`,
    beatEven: 'Tu bats l’araignée en autant de sauts.',
    beatDespite: (hops) => `Tu bats l’araignée, malgré ${plural(hops, 'saut')} de plus.`,
    spiderRetired: ' L’araignée a abandonné.',
    spiderOneAway: ' Elle était à un lien de la cible.',
    spiderCrawling: ' Elle rampait encore.',
    impossible: 'IMPOSSIBLE.',
    screenshot: '(fais une capture.)',
    hardWins: (wins) => ` Victoires en Difficile dans ce navigateur : ${wins}.`,
    win: 'Tu as gagné.',
    gaveUp: 'Tu as abandonné.',
    lose: 'L’araignée gagne.',
    nobody: 'Personne n’est arrivé.',
    nobodyDetail: 'Vous avez abandonné tous les deux.',
    status: { impossible: 'décédée', win: 'vaincue', 'gave-up': 'narquoise', lose: 'victorieuse', nobody: 'coincée' },
    you: 'Toi',
    spider: 'Araignée',
    hops: (n) => plural(n, 'saut'),
    complete: 'Course terminée',
    stats: 'Statistiques',
    yourTime: 'Ton temps',
    spiderTime: 'Temps de l’araignée',
    raceTime: 'Temps de course',
    yourHops: 'Tes sauts',
    spiderHops: 'Sauts de l’araignée',
    wordsEaten: 'Mots dévorés',
    yourPath: 'Ton chemin',
    spiderPath: 'Le chemin de l’araignée',
    rematch: 'Revanche',
    newPair: 'Nouvelle paire',
    copy: 'Copier les deux chemins',
    copied: 'Copié',
    copyFailed: 'Échec de la copie',
    foot: 'Texte des articles : Wikipédia, CC BY-SA 4.0. ',
    source: 'Code source',
    tags: { snatch: 'volé', 'dead-end': 'demi-tour', swap: 'échangé', back: 'retour' },
  },

  errors: {
    network: 'Impossible de joindre Wikipédia',
    http: (status) => `Wikipédia a répondu par une erreur (HTTP ${status})`,
    missing: (title) => `L’article « ${title} » n’existe pas sur Wikipédia en français.`,
  },

  demo: {
    text: [
      'Un ',
      { strong: 'robot d’indexation' },
      ' est un programme qui visite une page, lit ses liens et les suit, un saut à la fois. Les moteurs de recherche s’en servent pour cartographier le web, les archives pour le garder, et celui-ci pour te battre. Il lit chaque lien de la page, choisit le plus proche de la cible et rampe droit dessus.',
    ],
    live: 'live · crawler.demo',
    states: { boot: 'BOOTING', scan: 'SCANNING', lock: 'LOCKED', crawl: 'CRAWLING', eat: 'EATING' },
  },

  art: {
    scanning: 'analyse de 38 liens…',
    backlink: '0.82 backlink',
    locked: 'LOCKED · image_matricielle',
    hop: '+1 SAUT · sauts : 7',
    title: 'Image matricielle',
    cut: ['appr', 'oche'],
    carried: 'couleur',
    thrown: 'scènes',
    link: 'image matricielle',
  },
};
