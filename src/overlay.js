// overlay.js
// BRANDING / UI in basso, ripreso dalle demo porsche-shader / particles-shaders:
// firma autore + nome demo, selettore a "pills" con indicatore scorrevole animato,
// bottone play/pausa. Qui le pills sono le SORGENTI VIDEO (mappatura naturale).
//
// createOverlay() costruisce il DOM e ritorna degli handle per la sincronizzazione
// bidirezionale col pannello Tweakpane (setActiveVideo / setPlaying).

const ICON_PAUSE = `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>`;
const ICON_PLAY = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.14v13.72a1 1 0 0 0 1.54.84l10.3-6.86a1 1 0 0 0 0-1.68L9.54 4.3A1 1 0 0 0 8 5.14z"/></svg>`;
const ICON_SETTINGS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;

// Posiziona/anima l'indicatore scorrevole sotto la pill attiva.
function positionIndicator(indicator, pill, animate = true) {
  const x = pill.offsetLeft;
  const w = pill.offsetWidth;
  const h = pill.offsetHeight;
  indicator.style.transition = animate
    ? 'transform 0.55s cubic-bezier(0.16, 1, 0.3, 1), width 0.55s cubic-bezier(0.16, 1, 0.3, 1), height 0.55s cubic-bezier(0.16, 1, 0.3, 1)'
    : 'none';
  indicator.style.transform = `translateX(${x}px)`;
  indicator.style.width = w + 'px';
  indicator.style.height = h + 'px';
}

/**
 * @param {Object} opts
 * @param {Array<{label:string, src:string}>} opts.videos  sorgenti video (pills)
 * @param {string}  opts.currentSrc   src attualmente selezionata
 * @param {boolean} opts.paused       stato iniziale play/pausa
 * @param {(src:string)=>void} opts.onSelect      callback al cambio sorgente
 * @param {()=>void}           opts.onTogglePlay  callback al toggle play/pausa; deve ritornare il nuovo stato "paused"
 * @param {()=>boolean}        opts.onToggleSettings  callback al toggle pannello; deve ritornare se ora e VISIBILE
 * @param {boolean} [opts.settingsVisible]  stato iniziale del pannello (default visibile)
 * @returns {{ setActiveVideo:(src:string)=>void, setPlaying:(paused:boolean)=>void }}
 */
export function createOverlay({ videos, currentSrc, paused = false, onSelect, onTogglePlay, onToggleSettings, settingsVisible = true }) {
  // --- Container ---
  const container = document.createElement('div');
  container.className = 'bottom-ui';
  document.body.appendChild(container);

  // --- Header (firma a sinistra, play/pausa a destra) ---
  const header = document.createElement('div');
  header.className = 'bottom-header';
  container.appendChild(header);

  const brandLeft = document.createElement('div');
  brandLeft.className = 'brand-left';
  header.appendChild(brandLeft);

  const author = document.createElement('a');
  author.className = 'brand-author';
  author.href = 'https://niccolofanton.dev';
  author.target = '_blank';
  author.rel = 'noopener';
  author.textContent = 'niccolofanton.dev';
  brandLeft.appendChild(author);

  const brand = document.createElement('span');
  brand.className = 'brand-main';
  brand.textContent = 'ascii shader';
  brandLeft.appendChild(brand);

  const rightButtons = document.createElement('div');
  rightButtons.style.cssText = 'display:flex;gap:4px;align-items:center';
  header.appendChild(rightButtons);

  // Settings: mostra/nasconde il pannello Tweakpane.
  const settingsToggle = document.createElement('button');
  settingsToggle.className = 'settings-toggle';
  settingsToggle.title = 'Mostra / nascondi pannello';
  settingsToggle.innerHTML = ICON_SETTINGS;
  settingsToggle.classList.toggle('active', settingsVisible);
  settingsToggle.addEventListener('click', () => {
    const nowVisible = onToggleSettings ? onToggleSettings() : true;
    settingsToggle.classList.toggle('active', nowVisible);
  });
  rightButtons.appendChild(settingsToggle);

  const playToggle = document.createElement('button');
  playToggle.className = 'play-toggle';
  playToggle.title = 'Play / Pausa';
  playToggle.innerHTML = paused ? ICON_PLAY : ICON_PAUSE;
  playToggle.addEventListener('click', () => {
    const nowPaused = onTogglePlay ? onTogglePlay() : !paused;
    setPlaying(nowPaused);
  });
  rightButtons.appendChild(playToggle);

  // --- Preset bar (sorgenti video) ---
  const barWrapper = document.createElement('div');
  barWrapper.className = 'preset-bar-wrapper';
  container.appendChild(barWrapper);

  const bar = document.createElement('div');
  bar.className = 'preset-bar';
  barWrapper.appendChild(bar);

  const updateFadeEdges = () => {
    const sl = bar.scrollLeft;
    const maxScroll = bar.scrollWidth - bar.clientWidth;
    barWrapper.classList.toggle('fade-left', sl > 4);
    barWrapper.classList.toggle('fade-right', sl < maxScroll - 4);
  };
  bar.addEventListener('scroll', updateFadeEdges, { passive: true });

  const indicator = document.createElement('div');
  indicator.className = 'preset-indicator';
  bar.appendChild(indicator);

  const pills = [];
  videos.forEach(({ label, src }) => {
    const pill = document.createElement('button');
    pill.className = 'preset-pill';
    pill.textContent = label;
    pill.dataset.src = src;
    pill.dataset.label = label; // usato dal "fantasma" bold per riservare larghezza (no reflow)
    if (src === currentSrc) pill.classList.add('active');
    pill.addEventListener('click', () => {
      if (pill.classList.contains('active')) return;
      setActiveVideo(src);
      if (onSelect) onSelect(src);
    });
    bar.appendChild(pill);
    pills.push(pill);
  });

  // Posiziona l'indicatore sulla pill attiva (senza animazione al primo frame).
  requestAnimationFrame(() => {
    updateFadeEdges();
    const activePill = bar.querySelector('.preset-pill.active') || pills[0];
    if (activePill) {
      positionIndicator(indicator, activePill, false);
      const barRect = bar.getBoundingClientRect();
      const pillRect = activePill.getBoundingClientRect();
      bar.scrollLeft = Math.max(0, activePill.offsetLeft - barRect.width / 2 + pillRect.width / 2);
      updateFadeEdges();
    }
  });

  // --- API per sync col pannello ---
  function setActiveVideo(src) {
    let target = null;
    pills.forEach((p) => {
      const on = p.dataset.src === src;
      p.classList.toggle('active', on);
      if (on) target = p;
    });
    if (target) positionIndicator(indicator, target, true);
  }

  function setPlaying(isPaused) {
    paused = isPaused;
    playToggle.innerHTML = isPaused ? ICON_PLAY : ICON_PAUSE;
  }

  return { setActiveVideo, setPlaying };
}
