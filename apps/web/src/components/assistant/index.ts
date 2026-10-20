/**
 * The assistant's boot: the launcher, the teaser, and the doors to everything
 * else. It stays tiny on purpose: no three.js, no panel code, no markdown, no
 * stream reader. The panel loads on first intent (hover, focus, click, or idle
 * ~4 s after the page settles) and the mascot (via the dock) once the page has
 * settled (~2.5 s). three.js is a third, later chunk that only the dock asks
 * for, and only when the browser can run it.
 *
 * THE WIDGET ONLY APPEARS WHEN ITS SERVICE ANSWERS. The root is built with
 * `data-wait` (hidden) and shown once /api/assistant/status says ok, so a build
 * deployed where the API is not (a preview, a missing secret, the service down)
 * never offers a chat that cannot reply. A yes is remembered for ten minutes in
 * this tab, so the next page shows the launcher at once and re-checks behind it.
 *
 * Framework-agnostic: `mountAssistant` builds its own DOM, appended to <body>,
 * and `destroy()` removes every trace. The React island (Assistant.tsx) only
 * calls it once, feeds it the route, and cleans up.
 */
import { S, startersFor } from './config';
import { dismissTeaser, load, markTeaserShown, teaserDismissed } from './store';

type Panel = typeof import('./panel');
type Dock = typeof import('./dock');

export interface AssistantOptions {
  /** Client-side navigation, for links inside the chat. */
  navigate: (href: string) => void;
}

export interface AssistantHandle {
  /** The route changed: starters and the clear-spot check follow it. */
  setPath(path: string): void;
  destroy(): void;
}

/** Where the teaser may speak as a bubble: a large screen with a mouse. */
const BUBBLE = '(hover: hover) and (pointer: fine) and (min-width: 1024px)';
const POSTER_SMALL = '/assistant/snapper-poster-160.webp';
const UP = 'snap-assistant:up';
const UP_FOR = 10 * 60 * 1000;
const SVG = 'http://www.w3.org/2000/svg';

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] => {
  const n = document.createElement(tag);
  n.className = cls;
  if (text) n.textContent = text;
  return n;
};

/** Wait `ms`, then run when the browser is idle. */
function idle(fn: () => void, ms: number, timers: Set<number>): void {
  const id = window.setTimeout(() => {
    timers.delete(id);
    if ('requestIdleCallback' in window) requestIdleCallback(fn, { timeout: 1500 });
    else fn();
  }, ms);
  timers.add(id);
}

interface Dom {
  root: HTMLElement;
  btn: HTMLButtonElement;
  anchor: HTMLElement;
  poster: HTMLImageElement;
  teaser: HTMLElement;
  dot: HTMLElement;
  panel: HTMLElement;
}

/** The launcher and its empty containers. The panel, the markdown and the mascot are filled in later. */
function build(): Dom {
  const root = h('div', 'sa-root');
  root.id = 'sa-root';
  root.setAttribute('data-wait', '');

  const teaser = h('div', 'sa-teaser');
  teaser.setAttribute('role', 'group');
  teaser.hidden = true;

  const btn = h('button', 'sa-launcher');
  btn.id = 'sa-launcher';
  btn.type = 'button';
  btn.setAttribute('aria-expanded', 'false');
  btn.setAttribute('aria-controls', 'sa-panel');
  btn.setAttribute('aria-label', S.launcher);

  const pill = h('span', 'sa-pill', S.pill);
  pill.setAttribute('aria-hidden', 'true');
  const orb = h('span', 'sa-orb');
  orb.setAttribute('aria-hidden', 'true');

  const anchor = h('span', 'sa-anchor');
  anchor.setAttribute('aria-hidden', 'true');
  const art = h('span', 'sa-art');
  // The seed: Snapper drawn in CSS gradients, so the orb is never empty. The poster covers it once loaded.
  const seed = h('span', 'sa-seed');
  seed.append(h('i', ''), h('b', ''));
  const poster = h('img', 'sa-poster');
  poster.alt = '';
  poster.width = 160;
  poster.height = 160;
  poster.decoding = 'async';
  poster.draggable = false;
  art.append(seed, poster);
  anchor.appendChild(art);

  const dot = h('span', 'sa-dot');
  dot.hidden = true;
  btn.append(pill, orb, anchor, dot);

  const panel = h('div', 'sa-panel');
  panel.id = 'sa-panel';
  panel.hidden = true;

  root.append(teaser, btn, panel);
  document.body.appendChild(root);
  return { root, btn, anchor, poster, teaser, dot, panel };
}

export function mountAssistant(opts: AssistantOptions): AssistantHandle {
  const { root, btn, anchor, poster, teaser: box, dot } = build();
  const html = document.documentElement;
  const offs: (() => void)[] = [];
  const timers = new Set<number>();
  let destroyed = false;
  let path = location.pathname;
  let booted = false;
  let checking = false;
  let lastCheck = 0;

  const on = <T extends EventTarget>(t: T, type: string, fn: (e: Event) => void, o?: AddEventListenerOptions | boolean): void => {
    t.addEventListener(type, fn, o);
    offs.push(() => t.removeEventListener(type, fn, o));
  };
  const after = (fn: () => void, ms: number): number => {
    const id = window.setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
    return id;
  };
  const every = (fn: () => void, ms: number): void => {
    const id = window.setInterval(fn, ms);
    offs.push(() => clearInterval(id));
  };

  /* ---- the service gate ---- */

  const recentlyUp = (): boolean => {
    try {
      const t = Number(sessionStorage.getItem(UP));
      return t > 0 && Date.now() - t < UP_FOR;
    } catch {
      return false;
    }
  };

  const serviceUp = async (): Promise<boolean> => {
    try {
      const r = await fetch('/api/assistant/status', { cache: 'no-store', credentials: 'same-origin' });
      const j = r.ok ? ((await r.json()) as { ok?: boolean }) : null;
      return j?.ok === true;
    } catch {
      return false;
    }
  };

  const show = (): void => {
    if (destroyed) return;
    if (!poster.getAttribute('src')) {
      const art = root.querySelector('.sa-art');
      // The poster covers the CSS seed once it has loaded; if it never does, the seed stays.
      poster.addEventListener('load', () => art?.classList.add('sa-ok'), { once: true });
      poster.src = POSTER_SMALL;
    }
    root.removeAttribute('data-wait');
    // For page CSS that keeps a bottom-right reserve clear of the launcher.
    html.setAttribute('data-sa-ready', '');
    if (!booted) {
      booted = true;
      boot();
    }
  };

  const gate = (): void => {
    if (checking || destroyed) return;
    checking = true;
    lastCheck = Date.now();
    if (recentlyUp()) show();
    void serviceUp().then((up) => {
      checking = false;
      if (destroyed) return;
      try {
        if (up) sessionStorage.setItem(UP, String(Date.now()));
        else sessionStorage.removeItem(UP);
      } catch {
        /* private mode: the check simply runs on every load */
      }
      if (up) show();
      else {
        root.setAttribute('data-wait', '');
        html.removeAttribute('data-sa-ready');
      }
    });
  };

  /* ---- what loads, and when ---- */

  const st = load();
  const phone = (): boolean => matchMedia('(max-width: 639px)').matches;
  let pp: Promise<Panel> | undefined;
  let dp: Promise<Dock> | undefined;
  let dock: Dock | undefined;
  let panelMod: Panel | undefined;

  const loadPanel = (): Promise<Panel> =>
    (pp ??= import('./panel').then((m) => {
      if (!destroyed) {
        m.mount(root, { navigate: opts.navigate, starters: () => startersFor(path) }, st);
        panelMod = m;
      }
      return m;
    }));
  const loadDock = (): Promise<Dock> =>
    (dp ??= import('./dock').then((d) => {
      if (!destroyed) {
        void d.start(root, anchor);
        dock = d;
      }
      return d;
    }));
  /** Run `fn` on the panel module, unless the widget was torn down while it loaded. */
  const withPanel = (fn: (m: Panel) => void): void => {
    void loadPanel().then((m) => {
      if (!destroyed && panelMod === m) fn(m);
    });
  };
  const withDock = (fn: (d: Dock) => void): void => {
    void loadDock().then((d) => {
      if (!destroyed && dock === d) fn(d);
    });
  };

  function boot(): void {
    on(btn, 'pointerenter', () => {
      void loadPanel();
      if (!st.open) dock?.mood('attentive');
    });
    on(btn, 'pointerleave', () => {
      if (!st.open) dock?.mood('idle');
    });
    on(btn, 'focus', () => void loadPanel());
    on(btn, 'click', () => {
      hideTeaser(1);
      withPanel((m) => m.toggle());
    });

    /* ---- the teaser ---- */
    const dotEl = dot;
    let said = false;
    let retreat = 0;

    /** why: 0 it retreated on its own (the dot stays), 1 the chat is opening, 2 the visitor dismissed it. */
    function hideTeaser(why: 0 | 1 | 2): void {
      clearTimeout(retreat);
      box.classList.remove('is-in');
      after(() => (box.hidden = true), 360);
      if (why === 2) dismissTeaser();
      if (why) dotEl.hidden = true;
    }

    function sayTeaser(): void {
      if (said || st.opened || st.open || teaserDismissed() || document.hidden) return;
      if (html.classList.contains('sa-yield')) return;
      said = true;
      markTeaserShown();
      // The bubble is ~300x130: on phones and tablets it would land on the page's content,
      // so there Snapper only waves and the dot says it has something to tell.
      if (!matchMedia(BUBBLE).matches) {
        dotEl.hidden = false;
        withDock((d) => d.wave());
        return;
      }
      const line = h('p', 'sa-tz-t', S.teaser);
      const chips = h('div', 'sa-tz-c');
      startersFor(path)
        .filter((s) => s.kind === 'ask')
        .slice(0, 2)
        .forEach((s) => {
          const c = h('button', 'sa-chip', s.label);
          c.type = 'button';
          c.addEventListener('click', () => {
            hideTeaser(1);
            withPanel((m) => void m.ask(s.label, s.kind));
          });
          chips.appendChild(c);
        });
      const x = h('button', 'sa-tz-x');
      x.type = 'button';
      x.setAttribute('aria-label', S.teaserClose);
      const svg = document.createElementNS(SVG, 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('aria-hidden', 'true');
      const p = document.createElementNS(SVG, 'path');
      p.setAttribute('d', 'm7 7 10 10M17 7 7 17');
      svg.appendChild(p);
      x.appendChild(svg);
      x.addEventListener('click', () => hideTeaser(2));
      box.textContent = '';
      box.append(line, chips, x);
      box.setAttribute('aria-label', S.teaserLabel);
      box.hidden = false;
      dotEl.hidden = false;
      requestAnimationFrame(() => box.classList.add('is-in'));
      withDock((d) => d.wave());
      retreat = after(() => hideTeaser(0), 20000);
      box.addEventListener('pointerenter', () => clearTimeout(retreat));
      // The reader moved on: the bubble goes with them (the dot stays).
      on(window, 'scroll', () => !box.hidden && hideTeaser(0), { once: true, passive: true });
    }

    /* ---- stepping aside ---- */
    // While the footer is up (its links sit bottom-right) or a field on the page
    // has focus, the closed launcher yields (assistant.css).
    let footUp = false;
    let fieldOn = false;
    const yieldNow = (): void => {
      const y = footUp || fieldOn;
      html.classList.toggle('sa-yield', y);
      if (y && !box.hidden) hideTeaser(0);
    };
    const foot = document.querySelector('footer');
    if (foot && 'IntersectionObserver' in window) {
      const io = new IntersectionObserver(
        (es) => {
          footUp = es.some((e) => e.isIntersecting);
          yieldNow();
        },
        { threshold: 0.02 },
      );
      io.observe(foot);
      offs.push(() => io.disconnect());
    }
    const isField = (t: EventTarget | null): boolean =>
      t instanceof HTMLElement && !root.contains(t) && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
    on(document, 'focusin', (e) => {
      fieldOn = isField(e.target);
      yieldNow();
    });
    on(document, 'focusout', () =>
      after(() => {
        fieldOn = isField(document.activeElement);
        yieldNow();
      }, 0),
    );
    offs.push(() => html.classList.remove('sa-yield'));

    /* ---- a clear spot ---- */
    // The closed orb must not sit on a link or a button. When the page comes to
    // rest the orb checks what is under it and floats up the right edge to the
    // nearest clear spot, or, when there is none, tucks into a slim tab in the
    // right gutter. The chat stays one tap away either way.
    const CONTROL = 'a[href],button,[role="button"],input,select,textarea,summary,label';
    const STEPS = 2;
    let up = 0;
    let tucked = false;
    const setSpot = (px: number, tuck: boolean): void => {
      if (px === up && tuck === tucked) return;
      up = px;
      tucked = tuck;
      root.style.setProperty('--sa-up', `${px}px`);
      root.classList.toggle('sa-tuck', tuck);
      dock?.track(700);
    };
    // Rectangles, not points: a control that only clips the orb's edge counts too.
    const PAD = 6;
    const MIN_AREA = 150;
    const covers = (x: number, y: number, w: number, hgt: number): boolean => {
      const L = x - PAD;
      const T = y - PAD;
      const R = x + w + PAD;
      const B = y + hgt + PAD;
      for (const c of document.querySelectorAll<HTMLElement>(CONTROL)) {
        if (root.contains(c)) continue;
        const bx = c.getBoundingClientRect();
        if (bx.right < L || bx.left > R || bx.bottom < T || bx.top > B) continue;
        const cs = getComputedStyle(c);
        if (cs.pointerEvents === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.1) continue;
        // Line by line: a link that wraps has a bounding box whose middle is the gap between its lines.
        for (const r of c.getClientRects()) {
          const iw = Math.min(R, r.right) - Math.max(L, r.left);
          const ih = Math.min(B, r.bottom) - Math.max(T, r.top);
          if (iw <= 0 || ih <= 0 || iw * ih < MIN_AREA) continue;
          // Painted there, not clipped by a scroller or covered.
          const cx = Math.max(L, r.left) + iw / 2;
          const cy = Math.max(T, r.top) + ih / 2;
          if (cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight) continue;
          if (document.elementsFromPoint(cx, cy).some((n) => n === c || c.contains(n))) return true;
        }
      }
      return false;
    };
    const findSpot = (): void => {
      if (btn.getAttribute('aria-expanded') === 'true' || root.hasAttribute('data-wait')) return;
      if (html.classList.contains('sa-yield')) return;
      const r = root.getBoundingClientRect();
      if (!r.width) return;
      const homeTop = r.top + up;
      const step = r.height + 12;
      for (let k = 0; k <= STEPS; k++) {
        const top = homeTop - k * step;
        if (top < 80) break;
        if (!covers(r.left, top, r.width, r.height)) return setSpot(k * step, false);
      }
      setSpot(0, true);
    };
    const looks: number[] = [];
    // Three times: once the move has settled, once the page's entrances have landed, and once more for slow ones.
    const look = (): void => {
      looks.splice(0).forEach((t) => clearTimeout(t));
      for (const ms of [600, 1500, 3000]) looks.push(window.setTimeout(findSpot, ms));
    };
    offs.push(() => looks.splice(0).forEach((t) => clearTimeout(t)));
    let lastScroll = 0;
    // Capture: an element that scrolls inside itself never scrolls the window.
    on(
      window,
      'scroll',
      () => {
        lastScroll = performance.now();
        look();
      },
      { capture: true, passive: true },
    );
    // And a quiet re-check while the page rests: late-arriving buttons land after any fixed delay.
    every(() => {
      if (document.hidden || performance.now() - lastScroll < 800) return;
      findSpot();
    }, 2500);
    on(window, 'resize', look, { passive: true });
    // Opening always starts from home (the panel sits above the orb's home); closing looks again.
    const mo = new MutationObserver(() => {
      if (btn.getAttribute('aria-expanded') === 'true') setSpot(0, false);
      else look();
    });
    mo.observe(btn, { attributes: true, attributeFilter: ['aria-expanded'] });
    offs.push(() => mo.disconnect());
    respot = look;
    look();

    /* ---- the teaser's timing: a while on the page, and a sign of life ---- */
    let timeUp = false;
    let touched = false;
    const maybe = (): void => {
      if (timeUp && touched) sayTeaser();
    };
    after(() => ((timeUp = true), maybe()), 10000);
    const onTouch = (): void => ((touched = true), maybe());
    for (const t of ['scroll', 'wheel', 'pointermove', 'touchstart', 'keydown']) {
      on(window, t, onTouch, { capture: true, once: true, passive: true });
    }
    on(document, 'visibilitychange', maybe);

    /* ---- when things load ---- */
    const settle = (): void => {
      idle(() => !destroyed && void loadDock(), 2500, timers);
      idle(() => !destroyed && void loadPanel(), 4000, timers);
    };
    if (document.readyState === 'complete') settle();
    else on(window, 'load', settle, { once: true });

    // An open panel stays open after a reload (desktop only: a phone's sheet starts closed).
    if (st.open) {
      if (phone()) st.open = false;
      else withPanel((m) => void m.open({ instant: true }));
    }
  }

  /** Set by `boot`: re-run the clear-spot check. */
  let respot: (() => void) | undefined;

  gate();

  return {
    setPath(next: string): void {
      if (destroyed || next === path) return;
      path = next;
      panelMod?.refresh();
      respot?.();
      // The service was down at load: look again now and then, not on every click.
      if (!booted && Date.now() - lastCheck > 30_000) gate();
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      offs.splice(0).forEach((f) => f());
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
      if (panelMod) panelMod.dispose();
      else dock?.dispose();
      html.removeAttribute('data-sa-ready');
      html.classList.remove('sa-yield', 'sa-lock', 'sa-fix');
      root.remove();
    },
  };
}
