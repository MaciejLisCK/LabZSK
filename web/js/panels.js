// Draggable splitters between the panels of the wide layout. Sizes stay in this browser only and are
// kept as chosen: a smaller window limits them for as long as it lasts, a larger one brings them back.

const STORAGE_KEY = 'labzsk-panels';
const KEY_STEP = 16;
const SPLITTER = 8;
const MIN_PM = 150;
const MIN_PO = 300; // the table and the cell preview below it
const MIN_LEFT = 420;

export function initPanels() {
  const layout = document.querySelector('.layout');
  const left = layout.querySelector(':scope > .left');
  const right = layout.querySelector(':scope > .right');
  const wide = matchMedia('(min-width: 1001px)');

  // sign: which way a positive pointer or arrow-key movement changes the size
  const panes = {
    right: { node: right, cssVar: '--right-w', axis: 'x', sign: -1, range: () => [280, layout.clientWidth - 16 - SPLITTER - MIN_LEFT] },
    cpu: { node: layout.querySelector('.cpu-scroll'), cssVar: '--cpu-h', axis: 'y', sign: 1, range: () => [200, left.clientHeight - SPLITTER - MIN_PM] },
    control: { node: layout.querySelector('.control'), cssVar: '--control-h', axis: 'y', sign: 1, range: () => [100, right.clientHeight - SPLITTER - MIN_PO] },
  };

  let sizes = {};
  try {
    sizes = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') ?? {};
  } catch { /* storage unavailable */ }

  const store = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sizes));
    } catch { /* storage unavailable */ }
  };

  const limit = (name, size) => {
    const [min, max] = panes[name].range();
    return Math.round(Math.max(min, Math.min(max, size)));
  };

  const show = (name, size) => document.documentElement.style.setProperty(panes[name].cssVar, `${size}px`);

  const fit = () => {
    if (!wide.matches) return;
    for (const name of Object.keys(panes)) {
      if (Number.isFinite(sizes[name])) show(name, limit(name, sizes[name]));
    }
  };

  const resize = (name, size) => {
    sizes[name] = limit(name, size);
    show(name, sizes[name]);
  };

  const measure = (name) => (panes[name].axis === 'x' ? panes[name].node.offsetWidth : panes[name].node.offsetHeight);

  for (const splitter of layout.querySelectorAll('.splitter')) {
    const name = splitter.dataset.pane;
    const { axis, sign } = panes[name];
    let start = null;

    splitter.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      splitter.focus({ preventScroll: true });
      splitter.setPointerCapture(e.pointerId);
      start = { pointer: axis === 'x' ? e.clientX : e.clientY, size: measure(name) };
      document.body.classList.add(`resizing-${axis}`);
    });
    splitter.addEventListener('pointermove', (e) => {
      if (start) resize(name, start.size + sign * ((axis === 'x' ? e.clientX : e.clientY) - start.pointer));
    });
    const finish = () => {
      if (!start) return;
      start = null;
      document.body.classList.remove(`resizing-${axis}`);
      store();
    };
    splitter.addEventListener('pointerup', finish);
    splitter.addEventListener('pointercancel', finish);

    splitter.addEventListener('dblclick', () => {
      delete sizes[name];
      document.documentElement.style.removeProperty(panes[name].cssVar);
      store();
    });
    splitter.addEventListener('keydown', (e) => {
      const keys = axis === 'x' ? { ArrowLeft: -1, ArrowRight: 1 } : { ArrowUp: -1, ArrowDown: 1 };
      if (!keys[e.key]) return;
      e.preventDefault();
      resize(name, measure(name) + sign * keys[e.key] * KEY_STEP);
      store();
    });
  }

  new ResizeObserver(fit).observe(layout);
  wide.addEventListener('change', fit);
  fit();
}
