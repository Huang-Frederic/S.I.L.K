import { describe, expect, it } from 'vitest';
import { sanitizeArticle } from '../src/wiki/sanitize';

/** A condensed Parsoid document exercising most of what we strip or keep. */
const PARSOID = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Spider</title>
<link rel="stylesheet" href="/w/load.php"/></head>
<body class="mw-parser-output">
<section data-mw-section-id="0">
  <div class="shortdescription nomobile noexcerpt noprint searchaux" style="display:none">Order of arachnids</div>
  <span class="mw-empty-elt"><link rel="mw:PageProp/Category" href="./Category:Spiders"/></span>
  <style>.hatnote{font-style:italic}</style>
  <div role="note" class="hatnote navigation-not-searchable">For other uses, see <a rel="mw:WikiLink" href="./Spider_(disambiguation)">Spider (disambiguation)</a>.</div>
  <table class="infobox biota" style="width:200px"><tbody>
    <tr><th colspan="2" class="infobox-above">Spider</th></tr>
    <tr><td colspan="2"><span typeof="mw:File"><a href="./File:Spider.jpg" class="mw-file-description"><img src="//upload.wikimedia.org/x.jpg"/></a></span></td></tr>
    <tr><td>Phylum:</td><td><a rel="mw:WikiLink" href="./Arthropod" title="Arthropod">Arthropoda</a></td></tr>
  </tbody></table>
  <p id="mwAQ" onclick="alert(1)"><b>Spiders</b> (<a rel="mw:WikiLink" href="./Order_(biology)" title="Order (biology)">order</a> Araneae) are
  <a rel="mw:WikiLink" href="./Arthropod" title="Arthropod" class="mw-redirect">arthropods</a> that spin
  <a rel="mw:WikiLink" href="./Spider_silk#Uses">silk</a>.<sup class="mw-ref reference" typeof="mw:Extension/ref"><a href="./Spider#cite_note-1">[1]</a></sup>
  They are not <a rel="mw:WikiLink" href="./Guanocyte?action=edit&amp;redlink=1" class="new">guanocytes</a>, nor
  <a rel="mw:WikiLink" href="./Spider" class="mw-selflink selflink">spiders</a>, nor
  <a rel="mw:WikiLink" href="./Spider#Anatomy" class="mw-selflink-fragment">anatomy</a>.
  See <a rel="mw:ExtLink nofollow" href="https://example.org" class="external text">a website</a>,
  <a rel="mw:WikiLink/Interwiki" href="https://fr.wikipedia.org/wiki/Araign%C3%A9e">French</a>,
  <a rel="mw:WikiLink" href="./Special:BookSources/123">ISBN 123</a> and
  <a rel="mw:WikiLink" href="./Category:Spiders">a category</a>.
  The formula <span class="mwe-math-element"><span class="mwe-math-mathml-inline" style="display: none;"><math alttext="{\\displaystyle E=mc^{2}}"></math></span><img src="x.svg" alt="{\\displaystyle E=mc^{2}}"/></span> is unrelated.</p>
  <figure typeof="mw:File/Thumb"><img src="x.jpg"/><figcaption>A caption with <a rel="mw:WikiLink" href="./Caption_link">a link</a></figcaption></figure>
  <p><script>alert('x')</script><iframe src="https://evil.example"></iframe></p>
</section>
<section data-mw-section-id="1"><h2 id="Anatomy">Anatomy</h2>
  <p>Legs are attached to the <a rel="mw:WikiLink" href="./Cephalothorax">cephalothorax</a>.</p>
  <ul><li><a rel="mw:WikiLink" href="./Leg">Leg</a></li></ul>
</section>
<section data-mw-section-id="2"><h2 id="See_also">See also</h2><ul><li><a rel="mw:WikiLink" href="./Glossary_of_spider_terms">Glossary of spider terms</a></li></ul></section>
<section data-mw-section-id="3"><h2 id="Gallery">Gallery</h2><ul class="gallery"><li><img src="y.jpg"/></li></ul></section>
<section data-mw-section-id="4"><h2 id="References">References</h2>
  <div class="mw-references-wrap"><ol class="mw-references references"><li><a rel="mw:WikiLink" href="./Reference_only">Reference only</a></li></ol></div>
</section>
<section data-mw-section-id="5"><h2 id="External_links">External links</h2><ul><li><a rel="mw:WikiLink" href="./External_section_link">x</a></li></ul></section>
<div role="navigation" class="navbox"><a rel="mw:WikiLink" href="./Navbox_link">Navbox link</a></div>
</body></html>`;

function sanitize(html = PARSOID) {
  return sanitizeArticle(html, { title: 'Spider' });
}

function linkTitles(body: HTMLElement): string[] {
  return Array.from(body.querySelectorAll<HTMLAnchorElement>('a.wiki-link')).map((a) => a.dataset.title!);
}

describe('sanitizeArticle', () => {
  it('keeps only links to other main-namespace articles in the body', () => {
    const { body, linkCount } = sanitize();
    expect(linkTitles(body)).toEqual([
      'Spider (disambiguation)',
      'Arthropod',
      'Order (biology)',
      'Arthropod',
      'Spider silk',
      'Cephalothorax',
      'Leg',
      'Glossary of spider terms',
    ]);
    expect(linkCount).toBe(8);
  });

  it('keeps the text of disabled links', () => {
    const text = sanitize().body.textContent!;
    for (const words of ['guanocytes', 'a website', 'French', 'ISBN 123', 'a category']) expect(text).toContain(words);
  });

  it('drops references, navboxes, figures, galleries and reference-like sections', () => {
    const { body } = sanitize();
    const text = body.textContent!;
    expect(text).not.toContain('[1]');
    expect(text).not.toContain('Navbox link');
    expect(text).not.toContain('A caption');
    expect(text).not.toContain('Reference only');
    expect(text).not.toContain('External section link');
    const headings = Array.from(body.querySelectorAll('h2')).map((h) => h.textContent);
    expect(headings).toEqual(['Anatomy', 'See also']);
  });

  it('removes anything executable, styled or remote', () => {
    const { body } = sanitize();
    expect(body.querySelector('script, style, link, iframe, img, figure, meta')).toBeNull();
    for (const el of Array.from(body.querySelectorAll('*'))) {
      for (const attr of Array.from(el.attributes)) {
        expect(['class', 'href', 'title', 'data-title', 'colspan', 'rowspan', 'start']).toContain(attr.name);
      }
    }
    expect(body.innerHTML).not.toContain('onclick');
    expect(body.innerHTML).not.toContain('mwAQ');
  });

  it('turns math into its TeX source', () => {
    expect(sanitize().body.querySelector('code')?.textContent).toBe('E=mc^{2}');
  });

  it('keeps hatnotes and infoboxes (minus their images) with styling classes', () => {
    const { body } = sanitize();
    expect(body.querySelector('.wiki-hatnote')?.textContent).toContain('For other uses');
    const infobox = body.querySelector('table.wiki-infobox')!;
    expect(infobox).not.toBeNull();
    expect(infobox.querySelectorAll('tr')).toHaveLength(2);
    expect(infobox.querySelector('.wiki-infobox-above')?.textContent).toBe('Spider');
  });

  it('reads the short description and the disambiguation flag', () => {
    const article = sanitize();
    expect(article.description).toBe('Order of arachnids');
    expect(article.isDisambiguation).toBe(false);
    const disambig = sanitize(PARSOID.replace('<section data-mw-section-id="0">', '<section data-mw-section-id="0"><meta property="mw:PageProp/disambiguation"/>'));
    expect(disambig.isDisambiguation).toBe(true);
  });

  it('wraps wide tables in a scroll container', () => {
    const html = PARSOID.replace('<h2 id="Anatomy">Anatomy</h2>', '<h2 id="Anatomy">Anatomy</h2><table class="wikitable"><tr><td>Cell</td></tr></table>');
    const table = sanitize(html).body.querySelector('table.wiki-wikitable')!;
    expect(table.parentElement?.className).toBe('wiki-table-wrap');
  });
});

/** A condensed French Wikipedia (Parsoid) page: frwiki's own namespaces, sections, banners and infoboxes. */
const PARSOID_FR = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Araignée</title></head>
<body class="mw-parser-output">
<section data-mw-section-id="0">
  <div class="bandeau-container homonymie plainlinks hatnote">Pour les articles homonymes, voir <a rel="mw:WikiLink" href="./Araign%C3%A9e_(homonymie)">Araignée (homonymie)</a>.</div>
  <div class="bandeau-container bandeau-article metadata"><a rel="mw:WikiLink" href="./Aide:Sources">Cet article ne cite pas ses sources</a>.</div>
  <div class="infobox_v3 noarchive"><div class="entete">Araignée</div>
    <table><caption>Classification</caption><tbody><tr><th scope="row">Règne</th><td><a rel="mw:WikiLink" href="./Animalia">Animalia</a></td></tr></tbody></table>
  </div>
  <p>Les <b>araignées</b> sont des <a rel="mw:WikiLink" href="./Arthropoda">arthropodes</a> qui tissent de la
  <a rel="mw:WikiLink" href="./Soie_d%27araign%C3%A9e">soie</a>, voir <a rel="mw:WikiLink" href="./Fichier:Araignee.jpg">l’image</a>,
  <a rel="mw:WikiLink" href="./Cat%C3%A9gorie:Araneae">la catégorie</a> et <a rel="mw:WikiLink" href="./Portail:Arachnologie">le portail</a>.</p>
</section>
<section data-mw-section-id="1"><div class="mw-heading mw-heading2"><h2 id="Anatomie">Anatomie</h2></div>
  <p>Les pattes sont fixées au <a rel="mw:WikiLink" href="./C%C3%A9phalothorax">céphalothorax</a>.</p>
</section>
<section data-mw-section-id="2"><div class="mw-heading mw-heading2"><h2 id="Notes_et_références">Notes et références</h2></div>
  <p><a rel="mw:WikiLink" href="./Seulement_en_note">Seulement en note</a></p>
</section>
<section data-mw-section-id="3"><div class="mw-heading mw-heading2"><h2 id="Annexes">Annexes</h2></div>
  <section data-mw-section-id="4"><div class="mw-heading mw-heading3"><h3 id="Articles_connexes">Articles connexes</h3></div>
    <ul><li><a rel="mw:WikiLink" href="./Toile_d%27araign%C3%A9e">Toile d’araignée</a></li></ul></section>
  <section data-mw-section-id="5"><div class="mw-heading mw-heading3"><h3 id="Bibliographie">Bibliographie</h3></div>
    <ul><li><a rel="mw:WikiLink" href="./Livre_cit%C3%A9">Livre cité</a></li></ul></section>
  <section data-mw-section-id="6"><div class="mw-heading mw-heading3"><h3 id="Liens_externes">Liens externes</h3></div>
    <ul><li><a rel="mw:WikiLink" href="./Lien_de_section_externe">x</a></li></ul></section>
</section>
<ul id="bandeau-portail" class="bandeau-portail"><li><a rel="mw:WikiLink" href="./Portail:Arachnologie">Portail de l’arachnologie</a></li></ul>
</body></html>`;

describe('sanitizeArticle on French Wikipedia', () => {
  const { body, linkCount } = sanitizeArticle(PARSOID_FR, { title: 'Araignée', lang: 'fr' });

  it('keeps links to articles only, whatever frwiki calls its namespaces', () => {
    expect(linkTitles(body)).toEqual(['Araignée (homonymie)', 'Animalia', 'Arthropoda', "Soie d'araignée", 'Céphalothorax', "Toile d'araignée"]);
    expect(linkCount).toBe(6);
  });

  it('drops notes, bibliography, external links, banners and the portal bar, but keeps the related articles', () => {
    const text = body.textContent ?? '';
    for (const gone of ['Seulement en note', 'Livre cité', 'Liens externes', 'Cet article ne cite pas', 'Portail de l’arachnologie']) expect(text).not.toContain(gone);
    expect(text).toContain('Articles connexes');
    expect(body.querySelector('.wiki-hatnote')?.textContent).toContain('Pour les articles homonymes');
  });

  it('styles frwiki infoboxes as infoboxes, without scrolling wrappers inside', () => {
    const infobox = body.querySelector('.wiki-infobox')!;
    expect(infobox).not.toBeNull();
    expect(infobox.textContent).toContain('Règne');
    expect(infobox.querySelector('.wiki-table-wrap')).toBeNull();
  });
});
