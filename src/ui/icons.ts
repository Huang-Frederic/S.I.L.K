/** Small line-art icons (inline SVG, drawn in code, no external assets). */

const PATHS: Record<string, string> = {
  // A die seen at an angle: outline plus five pips.
  dice: '<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><circle cx="8.5" cy="8.5" r="1.2" fill="currentColor"/><circle cx="15.5" cy="8.5" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="8.5" cy="15.5" r="1.2" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.2" fill="currentColor"/>',
  swap: '<path d="M7 4v14M7 18l-3.5-3.5M7 18l3.5-3.5M17 20V6M17 6l-3.5 3.5M17 6l3.5 3.5"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  eye: '<path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
};

export type IconName = keyof typeof PATHS;

export function icon(name: IconName, size = 16): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.6');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('icon');
  // Static, trusted markup defined above.
  svg.innerHTML = PATHS[name];
  return svg;
}
