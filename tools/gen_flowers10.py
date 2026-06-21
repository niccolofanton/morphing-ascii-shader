#!/usr/bin/env python3
# Genera un video RAW (rgb24) di un LOOP di 10 FIORI completamente diversi su SFONDO BIANCO.
# I primi 5 sono IDENTICI a gen_flowers.py (config verbatim, restano uguali); i 5 successivi
# sono NUOVI: petali LARGHI (sharp basso) e SOVRAPPOSTI, alcuni composti da piu' blooms con
# centri sfalsati che si sovrappongono. Fra un fiore e il successivo c'e un CROSSFADE morbido;
# il 10o ritorna al 1o -> loop perfetto. Movimento lento (oscillazione + "respiro"), periodico.
# I frame vengono scritti su stdout e mandati in pipe a ffmpeg.
#
# Uso:
#   python3 tools/gen_flowers10.py | ffmpeg -y -f rawvideo -pixel_format rgb24 \
#     -video_size 720x720 -framerate 30 -i - -c:v libx264 -profile:v high \
#     -pix_fmt yuv420p -an -movflags +faststart examples/public/assets/video.mp4
#
# NB: su stdout devono finire SOLO i byte dei frame (eventuali messaggi -> stderr).

import sys
import math
import numpy as np

W = H = 720
FPS = 30
DUR = 40.0                 # secondi (loop senza stacco): 4s per fiore x 10 fiori
N = int(FPS * DUR)
CX, CY = W / 2.0, H / 2.0
EDGE = 2.5                 # morbidezza bordi (px)
FADE = 0.22               # frazione di ogni segmento dedicata al crossfade verso il prossimo

# Griglia pixel: la teniamo a parte cosi' possiamo ricalcolare R/ANG attorno a un centro
# qualsiasi (serve per i blooms multipli con centri sfalsati).
YY, XX = np.mgrid[0:H, 0:W].astype(np.float64)
# Per il fiore singolo centrato usiamo i valori precalcolati (come l'originale).
DX = XX - CX
DY = YY - CY
R = np.hypot(DX, DY)
ANG = np.arctan2(DY, DX)


def col(*rgb):
    return np.array(rgb, dtype=np.float64)


# ---------------------------------------------------------------------------
# I PRIMI 5 FIORI: config VERBATIM da tools/gen_flowers.py (devono restare uguali).
# Campo opzionale 'blooms': lista di blooms (cx,cy in frazione di lato, scala, rot extra)
# da alfa-comporre l'uno sull'altro sul canvas bianco -> petali SOVRAPPOSTI.
FLOWERS = [
    # 1) Margherita: tanti petali sottili, rosa -> magenta, cuore giallo caldo.
    dict(P=13, sharp=2.4, amp2=0.0, P2=0, rot=0.0, maxr=0.40,
         inner=col(250, 180, 205), outer=col(214, 40, 120), core=col(250, 205, 70),
         coreR=0.13, dot=None),
    # 2) Tulipano: pochi petali larghi e tondi, arancio -> rosso, cuore prugna + bottone.
    dict(P=5, sharp=0.65, amp2=0.0, P2=0, rot=0.3, maxr=0.44,
         inner=col(255, 150, 70), outer=col(200, 30, 30), core=col(70, 20, 60),
         coreR=0.17, dot=col(255, 210, 120)),
    # 3) Stella: petali molto appuntiti, azzurro -> indaco, cuore ciano.
    dict(P=6, sharp=4.0, amp2=0.0, P2=0, rot=0.0, maxr=0.46,
         inner=col(120, 160, 255), outer=col(40, 30, 150), core=col(120, 230, 235),
         coreR=0.11, dot=None),
    # 4) Girasole: tantissimi petali, giallo -> arancio, grande cuore bruno.
    dict(P=22, sharp=1.7, amp2=0.0, P2=0, rot=0.0, maxr=0.47,
         inner=col(255, 225, 80), outer=col(235, 140, 20), core=col(70, 40, 20),
         coreR=0.27, dot=None),
    # 5) Rosa/complessa: petali "a strati" (doppia armonica), magenta -> viola, cuore scuro.
    dict(P=8, sharp=1.2, amp2=0.16, P2=16, rot=0.2, maxr=0.41,
         inner=col(245, 120, 210), outer=col(110, 30, 140), core=col(50, 15, 70),
         coreR=0.15, dot=col(250, 180, 230)),

    # ----------------------------------------------------------------------
    # I 5 NUOVI FIORI: petali LARGHI (sharp 0.4..0.8) e SOVRAPPOSTI. Palette nuove
    # e vivaci, completamente diverse dalle precedenti. Alcuni usano 'blooms' multipli
    # con centri sfalsati che si sovrappongono.

    # 6) Trio di papaveri turchesi: 3 blooms a 5 petali larghissimi (sharp 0.45),
    #    centri sfalsati a triangolo che si SOVRAPPONGONO. Turchese -> verde-acqua,
    #    cuore lime. Colori nuovi (mai usati nei primi 5).
    dict(P=5, sharp=0.45, amp2=0.0, P2=0, rot=0.6, maxr=0.30,
         inner=col(120, 240, 230), outer=col(20, 150, 160), core=col(190, 250, 90),
         coreR=0.20, dot=col(255, 255, 160),
         blooms=[(-0.13, -0.07, 1.00, 0.0),
                 (0.13, -0.07, 0.96, 1.05),
                 (0.0, 0.16, 1.04, 2.10)]),

    # 7) Peonia corallo-pesca a doppio strato: 2 blooms quasi concentrici (sfalsati di poco)
    #    con 7 e 14 petali tondissimi (sharp 0.55) -> petali ampi che si SOVRAPPONGONO a
    #    formare un fiore folto. Corallo -> magenta caldo, cuore bordeaux. Palette nuova.
    dict(P=7, sharp=0.55, amp2=0.18, P2=14, rot=0.0, maxr=0.34,
         inner=col(255, 170, 150), outer=col(230, 60, 110), core=col(120, 20, 50),
         coreR=0.16, dot=col(255, 220, 180),
         blooms=[(0.0, 0.0, 1.10, 0.0),
                 (0.06, 0.05, 0.78, 0.45)]),

    # 8) Coppia di clematidi viola-elettrico: 2 blooms a 6 petali larghi e arrotondati
    #    (sharp 0.5) affiancati che si SOVRAPPONGONO al centro. Viola elettrico -> blu reale,
    #    cuore giallo-verde brillante. Palette nuova (viola/blu vivido diverso dalla stella).
    dict(P=6, sharp=0.50, amp2=0.0, P2=0, rot=0.25, maxr=0.33,
         inner=col(200, 130, 255), outer=col(70, 40, 220), core=col(220, 255, 70),
         coreR=0.18, dot=col(255, 255, 200),
         blooms=[(-0.11, 0.0, 1.02, 0.0),
                 (0.11, 0.0, 1.00, 0.9)]),

    # 9) Ibisco fucsia-arancio (singolo, petali enormi): 5 petali larghissimi (sharp 0.40)
    #    che si toccano/SOVRAPPONGONO tra loro; gradiente fucsia -> arancio fuoco, cuore
    #    granata con lungo stigma chiaro. Palette nuova, molto calda e satura.
    dict(P=5, sharp=0.40, amp2=0.0, P2=0, rot=0.1, maxr=0.47,
         inner=col(255, 80, 180), outer=col(255, 140, 30), core=col(150, 20, 40),
         coreR=0.14, dot=col(255, 240, 150)),

    # 10) Cosmea bicolore lime-magenta (singolo, petali ampi a doppia armonica):
    #     8 petali larghi (sharp 0.6) con seconda armonica che li allarga ulteriormente
    #     facendoli SOVRAPPORRE. Verde lime -> magenta acceso, cuore arancio brillante.
    #     Palette nuova; chiude il loop tornando alla margherita.
    dict(P=8, sharp=0.60, amp2=0.22, P2=8, rot=0.4, maxr=0.45,
         inner=col(180, 240, 70), outer=col(230, 30, 150), core=col(255, 130, 20),
         coreR=0.16, dot=col(255, 235, 120)),
]
NF = len(FLOWERS)


def soft(signed):
    # Bordo morbido (anti-alias): signed = (R - r); >0 = dentro la forma.
    return np.clip(signed / EDGE + 0.5, 0.0, 1.0)[..., None]


def render_bloom(cfg, sway, breath, cx, cy, scale, rot_extra):
    # Renderizza UN bloom attorno a (cx,cy) e restituisce (colore, alpha) per la composizione.
    # 'scale' moltiplica maxr, 'rot_extra' aggiunge rotazione (per sfalsare blooms sovrapposti).
    maxr = cfg['maxr'] * scale * min(W, H)
    dx = XX - cx
    dy = YY - cy
    r = np.hypot(dx, dy)
    ang = np.arctan2(dy, dx)

    c = np.cos(cfg['P'] * (ang + cfg['rot'] + rot_extra + sway))
    profile = (0.5 * (c + 1.0)) ** cfg['sharp']            # [0,1]: 0 tra i petali, 1 sulla punta
    if cfg['amp2'] > 0.0:
        profile = np.clip(profile + cfg['amp2'] * np.cos(cfg['P2'] * (ang + cfg['rot'] + rot_extra)), 0.0, 1.2)
    Rf = maxr * breath * profile                            # bordo del petalo per angolo
    petal = soft(Rf - r)                                    # alpha del petalo

    grad = np.clip(r / maxr, 0.0, 1.0)[..., None]           # gradiente radiale del colore petalo
    pcol = cfg['inner'] * (1.0 - grad) + cfg['outer'] * grad

    coreR = cfg['coreR'] * maxr * breath
    core = soft(coreR - r)
    dota = soft(0.4 * coreR - r) if cfg['dot'] is not None else None

    # Componiamo il bloom su un livello trasparente: prima il petalo, poi cuore e bottone.
    bloom_col = pcol.copy()
    bloom_a = petal
    # cuore sopra il petalo
    bloom_col = bloom_col * (1.0 - core) + cfg['core'] * core
    bloom_a = bloom_a + core * (1.0 - bloom_a)
    if dota is not None:
        bloom_col = bloom_col * (1.0 - dota) + cfg['dot'] * dota
        bloom_a = bloom_a + dota * (1.0 - bloom_a)
    return bloom_col, bloom_a


def render_flower(cfg, sway, breath):
    # Canvas BIANCO puro; alfa-componiamo uno o piu' blooms (centri sfalsati = SOVRAPPOSTI).
    img = np.full((H, W, 3), 255.0)
    blooms = cfg.get('blooms')
    if blooms is None:
        # Fiore singolo centrato (comportamento identico all'originale).
        blooms = [(0.0, 0.0, 1.0, 0.0)]
    for (fx, fy, scale, rot_extra) in blooms:
        cx = CX + fx * W
        cy = CY + fy * H
        bcol, ba = render_bloom(cfg, sway, breath, cx, cy, scale, rot_extra)
        img = img * (1.0 - ba) + bcol * ba                  # over-composite sul canvas
    return img


out = sys.stdout.buffer
for n in range(N):
    t = n / N
    ph = 2.0 * math.pi * t
    sway = 0.16 * math.sin(2.0 * ph)        # oscillazione lenta (2 cicli sul loop)
    breath = 1.0 + 0.04 * math.sin(3.0 * ph)  # lieve "respiro" (3 cicli sul loop)

    seg = (t * NF) % NF
    idx = int(math.floor(seg))
    frac = seg - idx

    img = render_flower(FLOWERS[idx], sway, breath)

    # Crossfade morbido verso il prossimo fiore nella coda del segmento (loop: 10o -> 1o).
    if frac > (1.0 - FADE):
        w = (frac - (1.0 - FADE)) / FADE
        w = w * w * (3.0 - 2.0 * w)         # smoothstep
        nxt = render_flower(FLOWERS[(idx + 1) % NF], sway, breath)
        img = img * (1.0 - w) + nxt * w

    out.write(np.clip(img, 0.0, 255.0).astype(np.uint8).tobytes())

out.flush()
