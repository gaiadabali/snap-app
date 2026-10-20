/**
 * The assistant's panel: the UI and its state machine.
 *
 *   welcome -> conversation        the header compacts, the mascot docks left
 *   idle -> thinking -> streaming  "Looking at <page>", then the answer, a caret
 *   error | cta                    cards the assistant can put in the log
 *
 * Loaded on first intent (index.ts), never with the page. The mascot is not in
 * here: it lives in the dock (dock.ts) and travels between the launcher and
 * this panel's header. Every DOM write during a stream is batched into one
 * animation frame, and nothing the model writes ever reaches innerHTML.
 */
import { CTAS, ERROR_TEXT, NAME, S, type Cta, type IconName, type Starter } from './config';
import * as dock from './dock';
import { createMd, safeHref } from './md';
import type { Md } from './md';
import { save, type Msg, type Source, type State } from './store';
import { chatStream, type ChatEvent } from './stream';

/* ---------------------------------------------------------------- helpers */

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

type IconKey = IconName | 'send' | 'more' | 'down' | 'arrow' | 'renew' | 'retry' | 'doc';

const ICONS: Record<IconKey, string> = {
  chat: 'M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v6a2.5 2.5 0 0 1-2.5 2.5H11l-4 3.5V15h-.5A2.5 2.5 0 0 1 4 12.5Z',
  tag: 'M4 12.1V5.5A1.5 1.5 0 0 1 5.5 4h6.6a1.5 1.5 0 0 1 1.06.44l6.4 6.4a1.5 1.5 0 0 1 0 2.12l-6.7 6.7a1.5 1.5 0 0 1-2.12 0L4.44 13.16A1.5 1.5 0 0 1 4 12.1ZM8.6 8.6h.01',
  phone: 'M8 2.8h8a1.5 1.5 0 0 1 1.5 1.5v15.4a1.5 1.5 0 0 1-1.5 1.5H8a1.5 1.5 0 0 1-1.5-1.5V4.3A1.5 1.5 0 0 1 8 2.8zM10.5 18h3',
  receipt: 'M6 3.5h12V21l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3L6 21zM9 8h6M9 11.5h6M9 15h3.5',
  person: 'M12 11.5a3.8 3.8 0 1 0 0-7.6 3.8 3.8 0 0 0 0 7.6ZM4.6 20a7.4 7.4 0 0 1 14.8 0',
  spark: 'M12 3c.6 4.6 2.9 6.9 7.5 7.5-4.6.6-6.9 2.9-7.5 7.5-.6-4.6-2.9-6.9-7.5-7.5C9.1 9.9 11.4 7.6 12 3ZM19 16c.3 1.7 1.1 2.5 2.8 2.8-1.7.3-2.5 1.1-2.8 2.8-.3-1.7-1.1-2.5-2.8-2.8 1.7-.3 2.5-1.1 2.8-2.8Z',
  shield: 'M12 3 19.5 6v5.5c0 4.6-3.2 8.2-7.5 9.5-4.3-1.3-7.5-4.9-7.5-9.5V6zM8.8 12.2l2.2 2.2 4.4-4.6',
  camera:
    'M4 8.5a1.5 1.5 0 0 1 1.5-1.5h2.3l1.5-2.2h5.4l1.5 2.2h2.3A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5zM12 16.2a3.4 3.4 0 1 0 0-6.8 3.4 3.4 0 0 0 0 6.8z',
  offline: 'M3.5 3.5l17 17M8.3 6.4A6 6 0 0 1 17.6 10h.4a3.5 3.5 0 0 1 2.4 6.1M16 18.5H7a4 4 0 0 1-.9-7.9',
  send: 'M12 19V5.5M6.2 11.2 12 5.5l5.8 5.7',
  more: 'M6 12h.01M12 12h.01M18 12h.01',
  down: 'm6 9 6 6 6-6',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  renew: 'M4.5 12a7.5 7.5 0 0 1 13-5.1M19.5 4v3.8h-3.8M19.5 12a7.5 7.5 0 0 1-13 5.1M4.5 20v-3.8h3.8',
  retry: 'M4.5 12a7.5 7.5 0 0 1 13-5.1M19.5 4v3.8h-3.8',
  doc: 'M14 3.5H7a1.5 1.5 0 0 0-1.5 1.5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8zM14 3.5V8h4.5M9 13h6M9 16.5h4',
};

const SVG = 'http://www.w3.org/2000/svg';

function ico(name: IconKey, cls = 'sa-i'): SVGSVGElement {
  const s = document.createElementNS(SVG, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('class', cls);
  const p = document.createElementNS(SVG, 'path');
  p.setAttribute('d', ICONS[name]);
  s.appendChild(p);
  return s;
}

const sr = (t: string): HTMLElement => el('span', 'sa-sr', `${t}: `);
const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/* ----------------------------------------------------------------- state */

export interface PanelContext {
  /** Client-side navigation (the router's push), so a link in the chat does not reload the page. */
  navigate: (href: string) => void;
  /** The welcome screen's choices for the page the visitor is on now. */
  starters: () => Starter[];
}

let X!: PanelContext;
let S0!: State;
let root!: HTMLElement;
let launcher!: HTMLButtonElement;
let homeAnchor!: HTMLElement;
let panel!: HTMLElement;
let scrim!: HTMLElement;
let mounted = false;
let gone = false;
const offs: (() => void)[] = [];
const timers = new Set<number>();

/** A timeout the teardown can cancel. */
function later(fn: () => void, ms: number): number {
  const id = window.setTimeout(() => {
    timers.delete(id);
    fn();
  }, ms);
  timers.add(id);
  return id;
}

function listen<T extends EventTarget>(t: T, type: string, fn: (e: Event) => void, o?: AddEventListenerOptions | boolean): void {
  t.addEventListener(type, fn, o);
  offs.push(() => t.removeEventListener(type, fn, o));
}

interface Ui {
  head: HTMLElement;
  stage: HTMLElement;
  menuBtn: HTMLButtonElement;
  menu: HTMLElement;
  body: HTMLElement;
  log: HTMLElement;
  list: HTMLElement;
  welcome: HTMLElement;
  newPill: HTMLButtonElement;
  form: HTMLFormElement;
  field: HTMLElement;
  ta: HTMLTextAreaElement;
  send: HTMLButtonElement;
  count: HTMLElement;
  fu: HTMLElement | null;
}
let ui!: Ui;

let isOpen = false;
let busy = false;
let seq = 0;
let ctrl: AbortController | null = null;
let cur: Cur | null = null;
const els = new Map<Msg, HTMLElement>();

const RM = matchMedia('(prefers-reduced-motion: reduce)');
const PHONE = matchMedia('(max-width: 639px)');
const html = document.documentElement;
const EASE = 'cubic-bezier(0.22, 0.61, 0.36, 1)';

interface Cur {
  wrap: HTMLElement;
  bubble: HTMLElement;
  status: HTMLElement | null;
  mdEl: HTMLElement | null;
  md: Md | null;
  text: string;
  raf: number;
  sources: Source[];
  chips: string[];
  cta?: Cta;
  /** The conversation was reset under it: it must not write into the new one. */
  dead?: boolean;
  /** The reader was at the end of the log at the last paint: keep them there when the answer lands. */
  stick: boolean;
}

/* ------------------------------------------------------------------ mount */

export function mount(rootEl: HTMLElement, ctx: PanelContext, state: State): void {
  if (mounted) return;
  mounted = true;
  gone = false;
  root = rootEl;
  X = ctx;
  S0 = state;
  launcher = root.querySelector<HTMLButtonElement>('#sa-launcher')!;
  homeAnchor = root.querySelector<HTMLElement>('.sa-anchor')!;
  panel = root.querySelector<HTMLElement>('#sa-panel')!;
  void dock.start(root, homeAnchor);

  buildPanel();
  wire();
  if (S0.msgs.length) {
    enterChat(true);
    renderAll();
  } else {
    renderWelcome();
  }
}

function buildPanel(): void {
  panel.className = 'sa-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-labelledby', 'sa-title');
  panel.setAttribute('tabindex', '-1');
  panel.dataset.phase = 'welcome';

  scrim = el('div', 'sa-scrim');
  scrim.hidden = true;
  root.insertBefore(scrim, panel);

  /* header: the mascot's stage */
  const head = el('header', 'sa-head');
  const stage = el('div', 'sa-stage');
  stage.setAttribute('aria-hidden', 'true');
  const id = el('div', 'sa-id');
  const title = el('h2', 'sa-title', NAME);
  title.id = 'sa-title';
  const sub = el('p', 'sa-sub');
  sub.append(el('span', 'sa-live'), el('span', 'sa-subt', S.sub));
  id.append(title, sub);

  const tools = el('div', 'sa-tools');
  const menuBtn = el('button', 'sa-ib') as HTMLButtonElement;
  menuBtn.type = 'button';
  menuBtn.setAttribute('aria-label', S.menu);
  menuBtn.setAttribute('aria-haspopup', 'menu');
  menuBtn.setAttribute('aria-expanded', 'false');
  menuBtn.append(ico('more', 'sa-i sa-i-dots'));
  const minBtn = el('button', 'sa-ib') as HTMLButtonElement;
  minBtn.type = 'button';
  minBtn.setAttribute('aria-label', S.minimise);
  minBtn.append(ico('down'));
  minBtn.addEventListener('click', () => void close({ focus: true }));
  tools.append(menuBtn, minBtn);

  const menu = el('div', 'sa-menu');
  menu.setAttribute('role', 'menu');
  menu.hidden = true;
  const mk = (icon: IconKey, label: string, fn: () => void): HTMLButtonElement => {
    const b = el('button', 'sa-mi') as HTMLButtonElement;
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    b.append(ico(icon), label);
    b.addEventListener('click', () => {
      closeMenu();
      fn();
    });
    return b;
  };
  menu.append(
    mk('renew', S.newChat, () => resetChat()),
    mk('person', S.human, () => localAction('human', S.human)),
  );
  head.append(stage, id, tools);

  /* body: welcome over the log */
  const body = el('div', 'sa-body');
  const log = el('div', 'sa-log');
  log.setAttribute('role', 'log');
  log.setAttribute('aria-live', 'polite');
  log.setAttribute('aria-busy', 'false');
  log.setAttribute('aria-relevant', 'additions text');
  log.setAttribute('aria-label', S.logLabel);
  log.tabIndex = 0;
  const list = el('div', 'sa-list');
  log.appendChild(list);
  const welcome = el('div', 'sa-welcome');
  const newPill = el('button', 'sa-new') as HTMLButtonElement;
  newPill.type = 'button';
  newPill.hidden = true;
  newPill.append(S.newMsgs, ico('down', 'sa-i sa-i-s'));
  body.append(log, welcome, newPill);

  /* composer */
  const form = el('form', 'sa-comp');
  form.noValidate = true;
  const field = el('div', 'sa-field');
  const ta = el('textarea', 'sa-ta') as HTMLTextAreaElement;
  ta.rows = 1;
  ta.maxLength = 600;
  ta.placeholder = S.placeholder;
  ta.setAttribute('aria-label', S.composerLabel);
  ta.setAttribute('enterkeyhint', 'send');
  ta.autocomplete = 'off';
  const send = el('button', 'sa-send') as HTMLButtonElement;
  send.type = 'submit';
  send.disabled = true;
  send.setAttribute('aria-label', S.send);
  send.append(ico('send', 'sa-i sa-i-go'));
  const sq = document.createElementNS(SVG, 'svg');
  sq.setAttribute('viewBox', '0 0 24 24');
  sq.setAttribute('class', 'sa-i sa-i-stop');
  sq.setAttribute('aria-hidden', 'true');
  const rect = document.createElementNS(SVG, 'rect');
  rect.setAttribute('x', '7');
  rect.setAttribute('y', '7');
  rect.setAttribute('width', '10');
  rect.setAttribute('height', '10');
  rect.setAttribute('rx', '2.4');
  sq.appendChild(rect);
  send.appendChild(sq);
  field.append(ta, send);
  const noteRow = el('div', 'sa-nr');
  const count = el('span', 'sa-count');
  count.hidden = true;
  noteRow.append(el('p', 'sa-note', S.note), count);
  form.append(field, noteRow);

  panel.append(head, body, form, menu);
  ui = { head, stage, menuBtn, menu, body, log, list, welcome, newPill, form, field, ta, send, count, fu: null };
}

/* ----------------------------------------------------------------- events */

function wire(): void {
  const { ta, send, log, form, newPill, menuBtn, stage } = ui;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (busy) stop();
    else submitComposer();
  });
  send.addEventListener('click', (e) => {
    if (busy) {
      e.preventDefault();
      stop();
    }
  });

  let growQ = 0;
  let nodAt = 0;
  let calm = 0;
  ta.addEventListener('input', () => {
    send.disabled = !busy && !ta.value.trim();
    if (!growQ) {
      growQ = requestAnimationFrame(() => {
        growQ = 0;
        grow();
      });
    }
    const n = ta.value.length;
    ui.count.hidden = n < 450;
    ui.count.textContent = `${n}/600`;
    ui.count.classList.toggle('is-max', n >= 590);
    // The mascot nods along, at most about eight times a second.
    const now = performance.now();
    if (now - nodAt > 130) {
      nodAt = now;
      dock.nod();
    }
    if (!busy) dock.mood('listening');
    clearTimeout(calm);
    calm = window.setTimeout(settleMood, 1600);
    timers.add(calm);
  });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && (e as unknown as { keyCode: number }).keyCode !== 229) {
      e.preventDefault();
      if (!busy) submitComposer();
    }
  });

  log.addEventListener('scroll', () => {
    if (nearBottom()) newPill.hidden = true;
  });
  newPill.addEventListener('click', () => {
    newPill.hidden = true;
    scrollEnd(true);
  });

  // Poke the mascot: a click snaps; three quick ones make it dizzy.
  let pokes: number[] = [];
  stage.addEventListener('click', () => {
    const now = performance.now();
    pokes = pokes.filter((t) => now - t < 900);
    pokes.push(now);
    if (pokes.length >= 3) {
      pokes = [];
      dock.dizzy();
      dock.mood('happy');
      later(settleMood, 1600);
    } else dock.snap();
  });

  menuBtn.addEventListener('click', () => (ui.menu.hidden ? openMenu() : closeMenu()));
  ui.menu.addEventListener('keydown', (e) => {
    const items = [...ui.menu.querySelectorAll<HTMLButtonElement>('[role=menuitem]')];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[(i + 1) % items.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[(i - 1 + items.length) % items.length]?.focus();
    }
  });
  listen(
    document,
    'pointerdown',
    (e) => {
      if (!ui.menu.hidden && !ui.menu.contains(e.target as Node) && !ui.menuBtn.contains(e.target as Node)) closeMenu();
    },
    true,
  );

  // Esc and the phone focus trap.
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen) {
      e.preventDefault();
      if (!ui.menu.hidden) {
        closeMenu();
        ui.menuBtn.focus();
      } else void close({ focus: true });
    } else if (e.key === 'Tab' && isOpen && PHONE.matches) trap(e);
  });

  // A link inside the chat goes through the router (no reload); on a phone the sheet closes first.
  panel.addEventListener('click', (e) => {
    const a = (e.target as Element).closest<HTMLAnchorElement>('a[href]');
    if (!a) return;
    if (a.dataset.cta) {
      dock.mood('happy');
      dock.hop();
      later(settleMood, 2600);
    }
    const href = a.getAttribute('href') ?? '';
    if (href.startsWith('/') && !a.target && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      if (PHONE.matches) void close({ then: () => X.navigate(href) });
      else X.navigate(href);
    }
  });
  scrim.addEventListener('click', () => void close({ focus: true }));

  // The composer follows the on-screen keyboard.
  const vv = window.visualViewport;
  const follow = (): void => {
    if (!isOpen || !PHONE.matches || !vv) return;
    panel.style.setProperty('--sa-vvh', `${vv.height}px`);
    panel.style.setProperty('--sa-vvt', `${vv.offsetTop}px`);
    panel.classList.toggle('is-kb', window.innerHeight - vv.height > 120);
    if (nearBottom()) scrollEnd(false);
  };
  if (vv) {
    listen(vv, 'resize', follow);
    listen(vv, 'scroll', follow);
  }
  listen(PHONE, 'change', () => {
    if (!isOpen) return;
    if (PHONE.matches) lockScroll();
    else unlockScroll();
    syncMode();
    follow();
    dock.track(200);
  });
  root.addEventListener('focusin', (e) => {
    if (e.target === ta && PHONE.matches) later(() => scrollEnd(false), 250);
  });
}

function trap(e: KeyboardEvent): void {
  const f = [
    ...panel.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),textarea,[tabindex="0"]'),
  ].filter((n) => n.getClientRects().length > 0);
  if (!f.length) return;
  const first = f[0]!;
  const last = f[f.length - 1]!;
  if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

function openMenu(): void {
  ui.menu.hidden = false;
  ui.menuBtn.setAttribute('aria-expanded', 'true');
  requestAnimationFrame(() => ui.menu.classList.add('is-in'));
  ui.menu.querySelector<HTMLElement>('[role=menuitem]')?.focus();
}
function closeMenu(): void {
  if (ui.menu.hidden) return;
  ui.menu.classList.remove('is-in');
  ui.menu.hidden = true;
  ui.menuBtn.setAttribute('aria-expanded', 'false');
}

/* --------------------------------------------------------- open and close */

function syncMode(): void {
  panel.dataset.mode = PHONE.matches ? 'sheet' : 'float';
  panel.setAttribute('aria-modal', PHONE.matches ? 'true' : 'false');
  scrim.hidden = !PHONE.matches || !isOpen;
}

let scrollY0 = 0;
let fixed = false;
function lockScroll(): void {
  if (html.classList.contains('sa-lock')) return;
  scrollY0 = window.scrollY;
  html.classList.add('sa-lock');
  if (scrollY0 > 0) {
    html.style.setProperty('--sa-sy', `${scrollY0}px`);
    html.classList.add('sa-fix');
    fixed = true;
  }
}
function unlockScroll(): void {
  html.classList.remove('sa-lock', 'sa-fix');
  html.style.removeProperty('--sa-sy');
  if (fixed) window.scrollTo({ top: scrollY0, behavior: 'instant' as ScrollBehavior });
  fixed = false;
}

export interface OpenOpts {
  /** No travel, no stagger: restoring an open panel after a reload. */
  instant?: boolean;
  focus?: boolean;
}

export async function open(o: OpenOpts = {}): Promise<void> {
  if (isOpen || gone) return;
  const my = ++seq;
  isOpen = true;
  S0.open = true;
  S0.opened = true;
  save(S0);
  root.classList.add('sa-open');
  launcher.setAttribute('aria-expanded', 'true');
  root.querySelector<HTMLElement>('.sa-teaser')?.classList.remove('is-in');
  root.querySelector<HTMLElement>('.sa-dot')?.setAttribute('hidden', '');
  panel.hidden = false;
  syncMode();
  if (PHONE.matches) {
    lockScroll();
    const vv = window.visualViewport;
    if (vv) {
      panel.style.setProperty('--sa-vvh', `${vv.height}px`);
      panel.style.setProperty('--sa-vvt', `${vv.offsetTop}px`);
    }
  }
  const reduced = RM.matches || o.instant;
  panel.classList.toggle('is-in', !reduced);

  // Measure the panel at rest, before any transform, then travel.
  const r = panel.getBoundingClientRect();
  const lr = launcher.getBoundingClientRect();
  panel.style.transformOrigin = `${lr.left + lr.width / 2 - r.left}px ${lr.top + lr.height / 2 - r.top}px`;
  const sheet = PHONE.matches;
  if (sheet) {
    scrim.hidden = false;
    scrim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: reduced ? 1 : 380, easing: 'ease-out' });
  }
  void (reduced
    ? panel.animate([{ opacity: 0 }, { opacity: 1 }], { duration: o.instant ? 1 : 160 })
    : sheet
      ? panel.animate([{ transform: 'translateY(100%)' }, { transform: 'none' }], { duration: 380, easing: EASE })
      : panel.animate(
          [
            { opacity: 0, transform: 'translateY(14px) scale(0.92)', borderRadius: '44px' },
            { opacity: 1, transform: 'none', borderRadius: '26px' },
          ],
          { duration: 420, easing: EASE },
        ));

  if (reduced) dock.attach(ui.stage);
  else await dock.fly(ui.stage, { from: homeAnchor, ms: sheet ? 520 : 600, arc: sheet ? 34 : 26 });
  if (my !== seq || gone) return;
  if (!reduced) dock.hop();
  dock.mood(busy ? 'thinking' : 'idle');
  if (o.focus !== false && !o.instant) {
    if (!PHONE.matches) ui.ta.focus({ preventScroll: true });
    else panel.focus({ preventScroll: true });
  }
  scrollEnd(false);
}

export interface CloseOpts {
  focus?: boolean;
  then?: () => void;
}

export async function close(o: CloseOpts = {}): Promise<void> {
  if (!isOpen) {
    o.then?.();
    return;
  }
  const my = ++seq;
  isOpen = false;
  S0.open = false;
  save(S0);
  closeMenu();
  root.classList.remove('sa-open');
  launcher.setAttribute('aria-expanded', 'false');
  panel.classList.remove('is-in');
  const reduced = RM.matches;
  const sheet = PHONE.matches;
  if (sheet) scrim.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, easing: 'ease-in', fill: 'forwards' });
  const anim = reduced
    ? panel.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, fill: 'forwards' })
    : sheet
      ? panel.animate([{ transform: 'none' }, { transform: 'translateY(100%)' }], {
          duration: 300,
          easing: 'cubic-bezier(0.5, 0, 0.75, 0)',
          fill: 'forwards',
        })
      : panel.animate(
          [
            { opacity: 1, transform: 'none', borderRadius: '26px' },
            { opacity: 0, transform: 'translateY(10px) scale(0.94)', borderRadius: '40px' },
          ],
          { duration: 260, easing: 'cubic-bezier(0.4, 0, 0.7, 0.2)', fill: 'forwards' },
        );
  dock.mood('idle');
  const back = dock.fly(homeAnchor, { from: ui.stage, ms: reduced ? 0 : sheet ? 360 : 400, arc: 16 });
  await Promise.all([anim.finished.catch(() => 0), back]);
  if (my !== seq || gone) return;
  panel.hidden = true;
  anim.cancel();
  scrim.hidden = true;
  unlockScroll();
  if (o.focus) launcher.focus({ preventScroll: true });
  o.then?.();
}

export function toggle(): void {
  if (isOpen) void close({ focus: true });
  else void open();
}

export const opened = (): boolean => isOpen;

/** Open (if needed) and act on a starter: the teaser's chips come here. */
export async function ask(text: string, kind: Starter['kind'] = 'ask'): Promise<void> {
  if (!isOpen) await open({ focus: false });
  starterAction(kind, text);
}

/** The page changed (client-side navigation): the welcome screen's starters follow it. */
export function refresh(): void {
  if (!mounted || gone) return;
  if (panel.dataset.phase === 'welcome' && !ui.welcome.hidden) renderWelcome(false);
}

/* ---------------------------------------------------------------- welcome */

function renderWelcome(animate = true): void {
  const w = ui.welcome;
  w.textContent = '';
  w.classList.remove('is-gone');
  w.hidden = false;
  let i = 0;
  const st = <T extends HTMLElement>(n: T): T => {
    if (animate) n.setAttribute('data-st', '');
    n.style.setProperty('--i', String(i++));
    return n;
  };
  w.append(st(el('h3', 'sa-greet', S.greet)), st(el('p', 'sa-intro', S.intro)));
  const grid = el('div', 'sa-starters');
  X.starters().forEach((s) => {
    const b = el('button', 'sa-st') as HTMLButtonElement;
    b.type = 'button';
    const ic = el('span', 'sa-sti');
    ic.append(ico(s.icon));
    b.append(ic, el('span', 'sa-stl', s.label));
    b.addEventListener('click', () => starterAction(s.kind, s.label));
    grid.appendChild(st(b));
  });
  w.appendChild(grid);
}

function starterAction(kind: Starter['kind'], label: string): void {
  if (busy) return;
  if (kind === 'ask') send(label);
  else localAction('human', label);
}

function enterChat(instant = false): void {
  if (panel.dataset.phase === 'chat') return;
  panel.dataset.phase = 'chat';
  const w = ui.welcome;
  if (instant || RM.matches) w.hidden = true;
  else {
    w.classList.add('is-gone');
    later(() => {
      if (panel.dataset.phase === 'chat') w.hidden = true;
    }, 260);
  }
  if (!instant) dock.track(760);
}

function resetChat(): void {
  if (cur) cur.dead = true;
  stop();
  S0.msgs = [];
  els.clear();
  ui.list.textContent = '';
  ui.fu = null;
  save(S0);
  panel.dataset.phase = 'welcome';
  renderWelcome();
  panel.classList.remove('is-in');
  void panel.offsetWidth;
  if (!RM.matches) panel.classList.add('is-in');
  ui.newPill.hidden = true;
  ui.ta.value = '';
  ui.send.disabled = true;
  grow();
  dock.track(760);
  dock.mood('idle');
  dock.wave();
}

/* ----------------------------------------------------------------- log */

function nearBottom(): boolean {
  const l = ui.log;
  return l.scrollHeight - l.scrollTop - l.clientHeight < 96;
}

function scrollEnd(smooth: boolean): void {
  const l = ui.log;
  if (smooth && !RM.matches) l.scrollTo({ top: l.scrollHeight, behavior: 'smooth' });
  else l.scrollTop = l.scrollHeight;
}

function grow(): void {
  const t = ui.ta;
  t.style.height = 'auto';
  t.style.height = `${t.scrollHeight}px`;
}

function sourcesEl(list: Source[]): HTMLElement | null {
  const ok = list.filter((s) => s.title && safeHref(s.url) && !safeHref(s.url)!.external);
  if (!ok.length) return null;
  const box = el('div', 'sa-src');
  box.setAttribute('aria-label', S.sources);
  ok.slice(0, 3).forEach((s) => {
    const a = el('a', 'sa-s');
    a.href = s.url;
    a.append(ico('doc', 'sa-i sa-i-s'), el('span', 'sa-sx', s.title));
    box.appendChild(a);
  });
  return box;
}

function ctaCard(kind: Cta): HTMLElement {
  const c = CTAS[kind];
  const card = el('div', 'sa-cta');
  const a = el('a', 'sa-btn');
  a.href = c.href;
  a.dataset.cta = kind;
  a.append(c.label, ico('arrow', 'sa-i sa-i-s'));
  card.append(el('h4', 'sa-ct', c.title), el('p', 'sa-cp', c.text), a);
  return card;
}

/** The DOM for one stored message. */
function msgEl(m: Msg, fresh: boolean): HTMLElement {
  const w = el('div', `sa-m ${m.role === 'user' ? 'sa-u' : 'sa-a'}${fresh ? ' is-new' : ''}`);
  if (m.kind === 'cta' && m.cta) {
    w.classList.add('sa-wide');
    w.appendChild(ctaCard(m.cta));
    return w;
  }
  const b = el('div', 'sa-b');
  if (m.role === 'user') {
    b.append(sr(S.you), m.text);
    w.appendChild(b);
    return w;
  }
  b.appendChild(sr(NAME));
  if (m.kind === 'error') {
    b.classList.add('sa-err');
    b.append(el('p', 'sa-ep', m.text));
    w.appendChild(b);
    return w;
  }
  const md = el('div', 'sa-md');
  b.appendChild(md);
  createMd(md).set(m.text, false);
  if (m.stopped) md.appendChild(el('p', 'sa-stopped', S.stopped));
  w.appendChild(b);
  const src = m.sources?.length ? sourcesEl(m.sources) : null;
  if (src) w.appendChild(src);
  return w;
}

function renderAll(): void {
  ui.list.textContent = '';
  els.clear();
  S0.msgs.forEach((m) => {
    const n = msgEl(m, false);
    els.set(m, n);
    ui.list.appendChild(n);
  });
  followups();
  requestAnimationFrame(() => scrollEnd(false));
}

function add(m: Msg, fresh = true): HTMLElement {
  S0.msgs.push(m);
  const n = msgEl(m, fresh);
  els.set(m, n);
  ui.fu?.remove();
  ui.fu = null;
  ui.list.appendChild(n);
  save(S0);
  return n;
}

function followups(): void {
  ui.fu?.remove();
  ui.fu = null;
  if (busy) return;
  // Chips belong to the last model answer; a CTA card after it does not hide them.
  let last = S0.msgs[S0.msgs.length - 1];
  if (last?.kind === 'cta') last = S0.msgs[S0.msgs.length - 2];
  if (!last) return;
  let chips: string[] = [];
  let retry = false;
  if (last.role === 'assistant' && !last.kind) chips = (last.chips ?? []).filter((c) => c && c.length <= 90).slice(0, 3);
  else if (last.kind === 'error' && last.retry) retry = true;
  else if (last.role === 'user' && !last.local) retry = true; // the page changed mid-answer
  if (!chips.length && !retry) return;
  const fu = el('div', 'sa-fu');
  const chip = (text: string, i: number, fn: () => void, withIcon = false): void => {
    const c = el('button', 'sa-chip sa-fc') as HTMLButtonElement;
    c.type = 'button';
    c.style.setProperty('--i', String(i));
    if (withIcon) c.append(ico('retry', 'sa-i sa-i-s'));
    c.append(text);
    c.addEventListener('click', fn);
    fu.appendChild(c);
  };
  if (retry) chip(S.retry, 0, () => retryLast(), true);
  chips.forEach((c, i) => chip(c, i, () => send(c)));
  ui.list.appendChild(fu);
  ui.fu = fu;
}

/* ------------------------------------------------------------- sending */

function history(): { role: 'user' | 'assistant'; content: string }[] {
  return S0.msgs
    .filter((m) => !m.kind && !m.local && m.text.trim())
    .slice(-24)
    .map((m) => ({ role: m.role, content: m.role === 'user' ? m.text.slice(0, 600) : m.text.slice(0, 2000) }));
}

function submitComposer(): void {
  const t = ui.ta.value;
  if (!t.trim()) return;
  ui.ta.value = '';
  ui.count.hidden = true;
  ui.send.disabled = true;
  grow();
  send(t);
}

function send(text: string): void {
  const t = text.trim().slice(0, 600);
  if (!t || busy) return;
  enterChat();
  closeMenu();
  add({ role: 'user', text: t });
  scrollEnd(true);
  void run();
}

/** A choice that never reaches the model: the visitor asks for a person, the Help centre card answers. */
function localAction(kind: 'human', label: string): void {
  if (busy) return;
  enterChat();
  closeMenu();
  add({ role: 'user', text: label, local: true });
  const card: Msg = { role: 'assistant', text: '', kind: 'cta', cta: kind };
  later(
    () => {
      add(card);
      followups();
      scrollEnd(true);
    },
    RM.matches ? 0 : 280,
  );
  scrollEnd(true);
}

function setBusy(on: boolean): void {
  busy = on;
  ui.log.setAttribute('aria-busy', String(on));
  ui.form.classList.toggle('is-busy', on);
  ui.send.setAttribute('aria-label', on ? S.stop : S.send);
  ui.send.disabled = on ? false : !ui.ta.value.trim();
}

function settleMood(): void {
  if (gone) return;
  if (busy) dock.mood(cur?.mdEl ? 'talking' : 'thinking');
  else dock.mood('idle');
}

const dots = (): HTMLElement => {
  const d = el('span', 'sa-dots');
  d.setAttribute('aria-hidden', 'true');
  d.append(el('i'), el('i'), el('i'));
  return d;
};

function statusEl(looking?: string): HTMLElement {
  const s = el('div', 'sa-think');
  const lab = el('span', 'sa-tl');
  if (looking) {
    const [a, b = ''] = S.checking.split('{t}');
    lab.append(a ?? '', el('strong', '', looking), `${b}…`);
  } else lab.append(`${S.thinking}…`);
  s.append(lab, dots());
  return s;
}

function paint(c: Cur): void {
  c.raf = 0;
  if (!c.md) return;
  const near = nearBottom();
  c.stick = near;
  c.md.set(c.text, true);
  if (near) scrollEnd(false);
  else ui.newPill.hidden = false;
}

function schedule(c: Cur): void {
  if (!c.raf) c.raf = requestAnimationFrame(() => paint(c));
}

function startAnswer(c: Cur): void {
  if (c.mdEl) return;
  c.status?.remove();
  c.status = null;
  c.mdEl = el('div', 'sa-md');
  c.md = createMd(c.mdEl);
  c.bubble.classList.add('has-text');
  c.bubble.appendChild(c.mdEl);
  dock.mood('talking');
}

function finish(c: Cur, extra: Partial<Msg> = {}): void {
  cancelAnimationFrame(c.raf);
  c.raf = 0;
  if (c.md) c.md.set(c.text, false);
  c.wrap.classList.remove('is-live');
  const m: Msg = { role: 'assistant', text: c.text, sources: c.sources, chips: c.chips, ...extra };
  S0.msgs.push(m);
  els.set(m, c.wrap);
  const src = c.sources.length ? sourcesEl(c.sources) : null;
  if (src) c.wrap.appendChild(src);
}

async function run(): Promise<void> {
  setBusy(true);
  dock.mood('thinking');
  const wrap = el('div', 'sa-m sa-a is-new is-live');
  const bubble = el('div', 'sa-b');
  bubble.appendChild(sr(NAME));
  const status = statusEl();
  bubble.appendChild(status);
  wrap.appendChild(bubble);
  ui.fu?.remove();
  ui.fu = null;
  ui.list.appendChild(wrap);
  scrollEnd(true);

  const c: Cur = { wrap, bubble, status, mdEl: null, md: null, text: '', raf: 0, sources: [], chips: [], stick: true };
  cur = c;
  ctrl = new AbortController();
  let ended = false;

  const fail = (code: string, text?: string): void => {
    ended = true;
    const retry = code === 'unavailable' || code === 'network';
    const msg = text || ERROR_TEXT[code] || S.eBad;
    if (c.text) finish(c);
    else wrap.remove();
    const m: Msg = { role: 'assistant', text: msg, kind: 'error', retry };
    S0.msgs.push(m);
    const n = msgEl(m, true);
    els.set(m, n);
    ui.list.appendChild(n);
    dock.mood('sorry');
    later(settleMood, 3000);
  };

  const on = (ev: ChatEvent): void => {
    if (c.dead || gone) return;
    switch (ev.e) {
      case 'meta': {
        const t = ev.d.looking?.title;
        if (t && c.status) {
          const next = statusEl(clip(t, 48));
          c.status.replaceWith(next);
          c.status = next;
        }
        break;
      }
      case 'delta':
        if (!ev.d.t) break;
        startAnswer(c);
        c.text += ev.d.t;
        dock.speak(Math.min(1, 0.25 + ev.d.t.length / 16));
        schedule(c);
        break;
      case 'replace':
        startAnswer(c);
        c.md?.reset();
        c.text = ev.d.text;
        schedule(c);
        break;
      case 'actions':
        c.chips = (ev.d.chips ?? []).slice(0, 3);
        c.cta = ev.d.cta;
        break;
      case 'done':
        ended = true;
        c.sources = ev.d.sources ?? [];
        if (!c.text) {
          // An empty answer is an error to the reader.
          fail('unavailable');
          break;
        }
        finish(c);
        if (c.cta && c.cta in CTAS) add({ role: 'assistant', text: '', kind: 'cta', cta: c.cta });
        dock.mood('idle');
        break;
      case 'error':
        fail(ev.d.code, ev.d.text);
        break;
    }
  };

  try {
    await chatStream(
      {
        sessionId: S0.sid,
        page: { path: location.pathname, title: document.title.slice(0, 200) },
        messages: history(),
      },
      ctrl.signal,
      on,
    );
  } catch (err) {
    if ((err as DOMException)?.name === 'AbortError') {
      cancelAnimationFrame(c.raf);
      if (c.dead || gone) wrap.remove();
      else if (c.text) {
        c.md?.set(c.text, false);
        finish(c, { stopped: true, chips: [] });
      } else wrap.remove();
      ended = true;
    } else if (!ended) fail('network');
  } finally {
    if (!ended) fail('network');
    ctrl = null;
    cur = null;
    if (!gone) {
      const near = c.stick;
      setBusy(false);
      followups();
      if (isOpen) {
        if (near) {
          ui.newPill.hidden = true;
          scrollEnd(true);
        } else ui.newPill.hidden = false;
      } else {
        // Answered while minimised: tell the visitor on the launcher.
        root.querySelector<HTMLElement>('.sa-dot')?.removeAttribute('hidden');
      }
      save(S0);
      later(settleMood, 400);
    }
  }
}

function stop(): void {
  ctrl?.abort();
}

function retryLast(): void {
  if (busy) return;
  const last = S0.msgs[S0.msgs.length - 1];
  if (last?.kind === 'error') {
    S0.msgs.pop();
    els.get(last)?.remove();
    els.delete(last);
  }
  ui.fu?.remove();
  ui.fu = null;
  save(S0);
  void run();
}

/** Tear the panel down: abort a stream, drop global listeners and timers, release the scroll lock. */
export function dispose(): void {
  gone = true;
  ctrl?.abort();
  offs.splice(0).forEach((f) => f());
  timers.forEach((t) => clearTimeout(t));
  timers.clear();
  if (isOpen) unlockScroll();
  isOpen = false;
  busy = false;
  mounted = false;
  cur = null;
  ctrl = null;
  els.clear();
  dock.dispose();
}
