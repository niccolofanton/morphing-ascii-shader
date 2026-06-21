// examples/diag.js — POC diagnostico per la test-suite "barra URL".
// Caricato SOLO con ?diag (vedi index.html, in coda). Zero dipendenze, zero impatto
// in produzione.
//
// IDEA: Maestro non esegue JS nella pagina in modo affidabile, ma legge il TESTO dal
// DOM (assertVisible, auto-wait 7s) e fa screenshot. Quindi e' la PAGINA a calcolare
// gli invarianti e a stamparli come testo PASS/FAIL; Maestro li asserisce e cattura
// l'evidenza. Le unita' lvh/svh/dvh sono calcolate dal browser REALE e codificano la
// geometria della barra URL anche senza doverla togglare (in headless lvh==svh==dvh).

(() => {
  const TOL = 2; // px di tolleranza per arrotondamenti CSS/dpr
  const px = (n) => Math.round(n);

  // --- Probe nascoste delle tre viewport ---
  const mkProbe = (h) => {
    const d = document.createElement('div');
    d.style.cssText =
      `position:fixed;top:0;left:0;width:0;visibility:hidden;pointer-events:none;height:${h}`;
    document.body.appendChild(d);
    return d;
  };
  const pLv = mkProbe('100lvh');
  const pSv = mkProbe('100svh');
  const pDv = mkProbe('100dvh');

  // --- Overlay testuale (alto contrasto, una riga = un nodo: assertVisible affidabile) ---
  const box = document.createElement('div');
  box.id = 'maestro-diag';
  box.style.cssText =
    'position:fixed;top:0;left:0;z-index:2147483647;pointer-events:none;' +
    'font:600 13px/1.4 "Courier New",monospace;' +
    'padding:8px 10px;color:#000;background:rgba(255,255,0,0.92);max-width:100vw';
  document.body.appendChild(box);

  let resizes = 0;
  addEventListener('resize', () => { resizes++; });

  function compute() {
    const lvh = pLv.offsetHeight;
    const svh = pSv.offsetHeight;
    const dvh = pDv.offsetHeight;
    const bar = lvh - svh; // altezza barra URL (0 = headless/desktop senza chrome)
    const vv = window.visualViewport;
    const vvW = vv ? vv.width : innerWidth;
    const vvH = vv ? vv.height : innerHeight;
    const dpr = window.devicePixelRatio || 1;
    const dprCap = Math.min(dpr, 2);

    const cv = document.getElementById('scene');
    const card = document.querySelector('.bottom-ui');

    const checks = [];
    const add = (id, ok, info) => checks.push({ id, ok, info });

    if (cv && cv.width && cv.height) {
      const cssW = cv.clientWidth, cssH = cv.clientHeight;
      const bufW = cv.width, bufH = cv.height;
      // [1] il canvas (alto lvh) COPRE l'area visibile -> niente gap bianco dietro la barra
      add('CANVAS_COVERS', cssH + TOL >= vvH && cssW + TOL >= vvW,
          `css ${px(cssW)}x${px(cssH)} vv ${px(vvW)}x${px(vvH)}`);
      // [3] drawing buffer == css * min(dpr,2): cap a 2 e nessuno stretch
      const okW = Math.abs(bufW - Math.round(cssW * dprCap)) <= 1;
      const okH = Math.abs(bufH - Math.round(cssH * dprCap)) <= 1;
      add('DPR_CAP', okW && okH, `buf ${bufW}x${bufH} dpr ${dpr}>${dprCap}`);
    } else {
      add('CANVAS_COVERS', false, 'canvas #scene non pronto');
      add('DPR_CAP', false, 'canvas #scene non pronto');
    }

    // [2a] niente overflow ORIZZONTALE (un elemento troppo largo e' sempre un bug)
    const de = document.documentElement;
    add('NO_X_OVERFLOW', de.scrollWidth <= de.clientWidth + TOL,
        `scrollW ${de.scrollWidth} clientW ${de.clientWidth}`);
    // [2b] slack VERTICALE limitato: su mobile la pagina e' di proposito di poco piu' alta del
    //      viewport (serve a far minimizzare la barra di Safari, canvas comunque fixed). Deve
    //      restare piccolo, non diventare un overflow di contenuto fuori controllo.
    const slack = de.scrollHeight - lvh;
    add('SCROLL_BOUNDED', slack >= -TOL && slack <= 200, `slack ${px(slack)}px (lvh ${lvh})`);

    // [4] la card NON finisce dietro la barra (bottom entro l'area visibile)
    if (card) {
      const r = card.getBoundingClientRect();
      add('CARD_VISIBLE', r.bottom <= vvH + TOL && r.top >= -TOL,
          `bottom ${px(r.bottom)} vvH ${px(vvH)}`);
    } else {
      add('CARD_VISIBLE', false, '.bottom-ui assente');
    }

    const all = checks.every((c) => c.ok);

    const lines = [
      'MAESTRO-DIAG v1',
      `LVH ${lvh}  SVH ${svh}  DVH ${dvh}  BAR ${bar}`,
      `VV ${px(vvW)}x${px(vvH)}  DPR ${dpr}  RSZ ${resizes}`,
      ...checks.map((c) => `${c.ok ? 'PASS' : 'FAIL'} ${c.id} | ${c.info}`),
      `ALL ${all ? 'PASS' : 'FAIL'}`,
    ];
    box.textContent = '';
    for (const ln of lines) {
      const row = document.createElement('div');
      row.textContent = ln;
      box.appendChild(row);
    }
    box.style.background = all ? 'rgba(140,255,140,0.95)' : 'rgba(255,120,120,0.97)';
  }

  // Ricalcola su ogni evento che cambia la geometria + un tick periodico (il canvas
  // dell'app puo' inizializzarsi dopo; su iOS la large viewport si stabilizza dopo il
  // primo layout/orientamento).
  addEventListener('resize', compute);
  addEventListener('scroll', compute, { passive: true });
  addEventListener('orientationchange', () => setTimeout(compute, 350));
  if (window.visualViewport) {
    visualViewport.addEventListener('resize', compute);
    visualViewport.addEventListener('scroll', compute);
  }
  setInterval(compute, 300);
  compute();
})();
