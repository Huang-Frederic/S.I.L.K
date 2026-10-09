import { describe, expect, it } from 'vitest';
import {
  isArticleTitle,
  looseTitleKey,
  normalizeTitle,
  parseWikiHref,
  titleFromRestUrl,
  titleToPathSegment,
  wikipediaUrl,
} from '../src/wiki/titles';

describe('normalizeTitle', () => {
  it('turns underscores into spaces and capitalizes the first letter', () => {
    expect(normalizeTitle('albert_einstein')).toBe('Albert einstein');
    expect(normalizeTitle('  New   York_City ')).toBe('New York City');
    expect(normalizeTitle('éclair')).toBe('Éclair');
    expect(normalizeTitle('')).toBe('');
  });
});

describe('parseWikiHref', () => {
  it('parses Parsoid wiki links', () => {
    expect(parseWikiHref('./Albert_Einstein')).toEqual({ title: 'Albert Einstein', fragment: null });
    expect(parseWikiHref('./Toxin#Biological')).toEqual({ title: 'Toxin', fragment: 'Biological' });
    expect(parseWikiHref('./AC%2FDC')).toEqual({ title: 'AC/DC', fragment: null });
    expect(parseWikiHref('./Caf%C3%A9')).toEqual({ title: 'Café', fragment: null });
  });

  it('rejects red links, absolute URLs and broken encodings', () => {
    expect(parseWikiHref('./Guanocyte?action=edit&redlink=1')).toBeNull();
    expect(parseWikiHref('https://example.org/')).toBeNull();
    expect(parseWikiHref('//en.wikipedia.org/wiki/Foo')).toBeNull();
    expect(parseWikiHref('./%E0%A4%A')).toBeNull();
  });
});

describe('isArticleTitle', () => {
  it('accepts main-namespace titles, including ones with a colon', () => {
    expect(isArticleTitle('Spider')).toBe(true);
    expect(isArticleTitle('Star Wars: A New Hope')).toBe(true);
    expect(isArticleTitle('Toxin: Biological')).toBe(true);
  });

  it('rejects other namespaces', () => {
    for (const title of ['File:Spider.jpg', 'Category:Spiders', 'Help:IPA', 'Special:BookSources/123', 'Template talk:Foo', 'Wikipedia:About', 'Portal:Arthropods', 'WP:NPOV']) {
      expect(isArticleTitle(title)).toBe(false);
    }
  });

  it('knows French Wikipedia’s namespaces (and the English names, which work there too)', () => {
    for (const title of ['Fichier:Araignée.jpg', 'Catégorie:Araneae', 'Modèle:Taxobox', 'Portail:Arachnologie', 'Aide:Homonymie', 'Discussion:Araignée', 'Spécial:Recherche', 'File:Spider.jpg']) {
      expect(isArticleTitle(title, 'fr')).toBe(false);
    }
    expect(isArticleTitle('Star Wars : Un nouvel espoir', 'fr')).toBe(true);
    expect(isArticleTitle('Araignée', 'fr')).toBe(true);
    // In English, a French namespace name is just a title.
    expect(isArticleTitle('Portail:Foo', 'en')).toBe(true);
  });
});

describe('URLs', () => {
  it('encodes titles as path segments', () => {
    expect(titleToPathSegment('AC/DC')).toBe('AC%2FDC');
    expect(titleToPathSegment('C++')).toBe('C%2B%2B');
    expect(wikipediaUrl('Albert Einstein', 'en')).toBe('https://en.wikipedia.org/wiki/Albert_Einstein');
    expect(wikipediaUrl('Tour Eiffel', 'fr')).toBe('https://fr.wikipedia.org/wiki/Tour_Eiffel');
  });

  it('reads titles back from REST URLs, before and after the 307 redirect', () => {
    expect(titleFromRestUrl('https://en.wikipedia.org/api/rest_v1/page/html/United_States')).toBe('United States');
    expect(titleFromRestUrl('https://en.wikipedia.org/w/rest.php/v1/page/United_States/html?redirect=no')).toBe('United States');
    expect(titleFromRestUrl('https://en.wikipedia.org/w/rest.php/v1/page/AC%2FDC/html')).toBe('AC/DC');
    expect(titleFromRestUrl('https://en.wikipedia.org/wiki/Foo')).toBeNull();
  });

  it('builds loose keys for fuzzy comparisons', () => {
    expect(looseTitleKey('Pokémon')).toBe(looseTitleKey('pokemon'));
    expect(looseTitleKey('Hip-hop')).toBe('hiphop');
  });
});
