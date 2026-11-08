export interface FerryHost {
  host: HTMLElement;
  /** The closed shadow root. Only Ferry holds this reference; `host.shadowRoot` is null. */
  root: ShadowRoot;
  layer: HTMLDivElement;
  setTheme(theme: 'light' | 'dark'): void;
  destroy(): void;
}

/**
 * Mounts Ferry's in-page UI in a closed shadow root (PRD 5.2). The host paints nothing and ignores
 * pointer events; only Ferry's own surfaces inside the layer receive input.
 */
export function mountHost(doc: Document, cssText: string): FerryHost {
  const host = doc.createElement('ferry-ui');
  host.setAttribute('data-ferry', '');
  host.style.setProperty('all', 'initial');
  host.style.setProperty('position', 'fixed');
  host.style.setProperty('inset', '0');
  host.style.setProperty('pointer-events', 'none');
  host.style.setProperty('z-index', '2147483000');
  const root = host.attachShadow({ mode: 'closed' });
  const layer = doc.createElement('div');
  layer.className = 'ferry-layer';
  // Constructed sheets are not subject to the host page's style-src CSP; <style> is the fallback.
  const Sheet = doc.defaultView?.CSSStyleSheet;
  let adopted = false;
  if (Sheet !== undefined && 'replaceSync' in Sheet.prototype && 'adoptedStyleSheets' in root) {
    try {
      const sheet = new Sheet();
      sheet.replaceSync(cssText);
      root.adoptedStyleSheets = [sheet];
      adopted = true;
    } catch {
      adopted = false;
    }
  }
  if (!adopted) {
    const style = doc.createElement('style');
    style.textContent = cssText;
    root.append(style);
  }
  root.append(layer);
  (doc.body ?? doc.documentElement).append(host);
  return {
    host,
    root,
    layer,
    setTheme(theme) {
      host.setAttribute('data-theme', theme);
    },
    destroy() {
      host.remove();
    },
  };
}

const FONT_STYLE_ID = 'ferry-fonts';

/**
 * `@font-face` inside a shadow root is ignored by Chrome, so one rule goes into the page head under
 * a private family name (DESIGN 2.2). The URL is our own web accessible font; nothing else loads.
 */
export function injectFontFace(doc: Document, fontUrl: string): void {
  if (doc.getElementById(FONT_STYLE_ID) !== null) return;
  const style = doc.createElement('style');
  style.id = FONT_STYLE_ID;
  style.textContent = `@font-face{font-family:'Ferry Geist';font-style:normal;font-display:swap;font-weight:100 900;src:url(${JSON.stringify(fontUrl)}) format('woff2');}`;
  (doc.head ?? doc.documentElement).append(style);
}
