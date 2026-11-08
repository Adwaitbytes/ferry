/**
 * Tiny DOM builder for the in-page UI. Text only ever enters through `textContent`, so memory text,
 * receipts and page-derived strings can never become markup (THREAT_MODEL section 5, RT-23).
 */

type Child = Node | string | null | undefined | false;

export interface ElProps {
  className?: string;
  attrs?: Record<string, string>;
  text?: string;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  props: ElProps = {},
  children: readonly Child[] = [],
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  if (props.className !== undefined) node.className = props.className;
  for (const [name, value] of Object.entries(props.attrs ?? {})) node.setAttribute(name, value);
  if (props.text !== undefined) node.textContent = props.text;
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'string' ? doc.createTextNode(child) : child);
  }
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Lucide icon geometry (ISC licensed), drawn with DOM APIs. Only the icons the page UI needs. */
const ICONS = {
  check: [['path', { d: 'M20 6 9 17l-5-5' }]],
  x: [
    ['path', { d: 'M18 6 6 18' }],
    ['path', { d: 'm6 6 12 12' }],
  ],
  lock: [
    ['rect', { width: '18', height: '11', x: '3', y: '11', rx: '2', ry: '2' }],
    ['path', { d: 'M7 11V7a5 5 0 0 1 10 0v4' }],
  ],
  'circle-slash': [
    ['circle', { cx: '12', cy: '12', r: '10' }],
    ['line', { x1: '9', x2: '15', y1: '15', y2: '9' }],
  ],
  'loader-circle': [['path', { d: 'M21 12a9 9 0 1 1-6.219-8.56' }]],
  'shield-question': [
    [
      'path',
      {
        d: 'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z',
      },
    ],
    ['path', { d: 'M9.1 9a3 3 0 0 1 5.82 1c0 2-3 3-3 3' }],
    ['path', { d: 'M12 17h.01' }],
  ],
} as const;

export type IconName = keyof typeof ICONS;

export function icon(doc: Document, name: IconName, size = 14): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, 'svg');
  for (const [k, v] of Object.entries({
    width: String(size),
    height: String(size),
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.75',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
    class: `ferry-icon ferry-icon-${name}`,
  })) {
    svg.setAttribute(k, v);
  }
  for (const [tag, attrs] of ICONS[name]) {
    const part = doc.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) part.setAttribute(k, v);
    svg.append(part);
  }
  return svg;
}

/** The Ferry mark: a 2px circle with a horizontal waterline (DESIGN 7.11). */
export function ferryMark(doc: Document, size = 20): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, 'svg');
  for (const [k, v] of Object.entries({
    width: String(size),
    height: String(size),
    viewBox: '0 0 20 20',
    fill: 'none',
    'aria-hidden': 'true',
    class: 'ferry-mark',
  })) {
    svg.setAttribute(k, v);
  }
  const circle = doc.createElementNS(SVG_NS, 'circle');
  for (const [k, v] of Object.entries({
    cx: '10',
    cy: '10',
    r: '8',
    stroke: 'currentColor',
    'stroke-width': '2',
  }))
    circle.setAttribute(k, v);
  const line = doc.createElementNS(SVG_NS, 'line');
  for (const [k, v] of Object.entries({
    x1: '3',
    x2: '17',
    y1: '11',
    y2: '11',
    stroke: 'currentColor',
    'stroke-width': '2',
    'stroke-linecap': 'round',
  })) {
    line.setAttribute(k, v);
  }
  svg.append(circle, line);
  return svg;
}

export function clear(node: Node): void {
  while (node.firstChild !== null) node.removeChild(node.firstChild);
}
