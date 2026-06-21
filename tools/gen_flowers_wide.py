#!/usr/bin/env python3
# Genera un video RAW (rgb24) di un LOOP di 17 FIORI a PETALI LARGHI su SFONDO BIANCO.
# Selezione rispetto a gen_flowers10.py: sono stati RIMOSSI i fiori a petali piccoli/sottili
# (margherita P=13, stella P=6 sharp=4, girasole P=22). MANTENUTI: tulipano e rosa (petali
# non piccoli) + i 5 "nuovi" gia' presenti (papaveri turchesi, peonia corallo, clematidi viola,
# ibisco fucsia-arancio, cosmea lime-magenta). AGGIUNTI: 10 fiori COMPLETAMENTE NUOVI, tutti a
# PETALI LARGHI (sharp basso ~0.4..0.8) e SOVRAPPOSTI; per molti si usano composizioni
# multi-bloom con 2-3 centri sfalsati che si sovrappongono (campo 'blooms'). Palette vivaci e
# nuove su sfondo BIANCO puro. Fra un fiore e il successivo c'e un CROSSFADE morbido; l'ultimo
# ritorna al primo -> loop perfetto. Movimento lento (oscillazione + "respiro"), periodico.
# I frame vengono scritti su stdout e mandati in pipe a ffmpeg.
#
# Uso:
#   python3 tools/gen_flowers_wide.py | ffmpeg -y -f rawvideo -pixel_format rgb24 \
#     -video_size 720x720 -framerate 30 -i - -c:v libx264 -profile:v high \
#     -pix_fmt yuv420p -an -movflags +faststart examples/public/assets/video.mp4
#
# NB: su stdout devono finire SOLO i byte dei frame (eventuali messaggi -> stderr).

import sys
import math
import numpy as np

W = H = 720
FPS = 30
# 4s per fiore: la durata si deriva dal numero di fiori, cosi' resta coerente.
SECS_PER_FLOWER = 4.0
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
# ELENCO FIORI (tutti a petali LARGHI). Campo opzionale 'blooms': lista di blooms
# (cx,cy in frazione di lato, scala, rot extra) da alfa-comporre l'uno sull'altro sul
# canvas bianco -> petali SOVRAPPOSTI.
FLOWERS = [
    # =======================================================================
    # MANTENUTI da gen_flowers10.py (petali non piccoli). Config VERBATIM.
    # =======================================================================
    # 1) Tulipano: pochi petali larghi e tondi, arancio -> rosso, cuore prugna + bottone.
    dict(P=5, sharp=0.65, amp2=0.0, P2=0, rot=0.3, maxr=0.44,
         inner=col(255, 150, 70), outer=col(200, 30, 30), core=col(70, 20, 60),
         coreR=0.17, dot=col(255, 210, 120)),
    # 2) Rosa/complessa: petali "a strati" (doppia armonica), magenta -> viola, cuore scuro.
    dict(P=8, sharp=1.2, amp2=0.16, P2=16, rot=0.2, maxr=0.41,
         inner=col(245, 120, 210), outer=col(110, 30, 140), core=col(50, 15, 70),
         coreR=0.15, dot=col(250, 180, 230)),

    # =======================================================================
    # MANTENUTI: i 5 "nuovi" gia' presenti (petali larghi + sovrapposti). VERBATIM.
    # =======================================================================
    # 3) Trio di papaveri turchesi: 3 blooms a 5 petali larghissimi (sharp 0.45),
    #    centri sfalsati a triangolo che si SOVRAPPONGONO. Turchese -> verde-acqua,
    #    cuore lime.
    dict(P=5, sharp=0.45, amp2=0.0, P2=0, rot=0.6, maxr=0.30,
         inner=col(120, 240, 230), outer=col(20, 150, 160), core=col(190, 250, 90),
         coreR=0.20, dot=col(255, 255, 160),
         blooms=[(-0.13, -0.07, 1.00, 0.0),
                 (0.13, -0.07, 0.96, 1.05),
                 (0.0, 0.16, 1.04, 2.10)]),
    # 4) Peonia corallo-pesca a doppio strato: 2 blooms quasi concentrici con 7 e 14 petali
    #    tondissimi (sharp 0.55) -> petali ampi che si SOVRAPPONGONO. Corallo -> magenta caldo.
    dict(P=7, sharp=0.55, amp2=0.18, P2=14, rot=0.0, maxr=0.34,
         inner=col(255, 170, 150), outer=col(230, 60, 110), core=col(120, 20, 50),
         coreR=0.16, dot=col(255, 220, 180),
         blooms=[(0.0, 0.0, 1.10, 0.0),
                 (0.06, 0.05, 0.78, 0.45)]),
    # 5) Coppia di clematidi viola-elettrico: 2 blooms a 6 petali larghi e arrotondati
    #    (sharp 0.5) affiancati che si SOVRAPPONGONO al centro. Viola elettrico -> blu reale.
    dict(P=6, sharp=0.50, amp2=0.0, P2=0, rot=0.25, maxr=0.33,
         inner=col(200, 130, 255), outer=col(70, 40, 220), core=col(220, 255, 70),
         coreR=0.18, dot=col(255, 255, 200),
         blooms=[(-0.11, 0.0, 1.02, 0.0),
                 (0.11, 0.0, 1.00, 0.9)]),
    # 6) Ibisco fucsia-arancio (singolo, petali enormi): 5 petali larghissimi (sharp 0.40)
    #    che si toccano/SOVRAPPONGONO; gradiente fucsia -> arancio fuoco, cuore granata.
    dict(P=5, sharp=0.40, amp2=0.0, P2=0, rot=0.1, maxr=0.47,
         inner=col(255, 80, 180), outer=col(255, 140, 30), core=col(150, 20, 40),
         coreR=0.14, dot=col(255, 240, 150)),
    # 7) Cosmea bicolore lime-magenta (singolo, petali ampi a doppia armonica): 8 petali larghi
    #    (sharp 0.6) con seconda armonica che li allarga -> SOVRAPPOSTI. Lime -> magenta acceso.
    dict(P=8, sharp=0.60, amp2=0.22, P2=8, rot=0.4, maxr=0.45,
         inner=col(180, 240, 70), outer=col(230, 30, 150), core=col(255, 130, 20),
         coreR=0.16, dot=col(255, 235, 120)),

    # =======================================================================
    # 10 FIORI NUOVI: completamente diversi, PETALI LARGHI (sharp 0.40..0.80),
    # SOVRAPPOSTI. Almeno 5 usano composizioni multi-bloom con centri sfalsati.
    # Palette vivaci e nuove (mai usate sopra), tutte su sfondo BIANCO.
    # =======================================================================

    # NB: per garantire PETALI LARGHI il numero di petali P resta BASSO (4..8) e lo
    # sharp basso (0.40..0.75); NON si usa la doppia armonica (amp2) perche' rende
    # appuntite le punte. I petali coprono cosi' un grande arco angolare e si toccano.

    # 8) [MULTI] Trio di anemoni blu-cobalto: 3 blooms a 4 petali larghissimi (sharp 0.45)
    #    disposti a triangolo che si SOVRAPPONGONO. Azzurro cielo -> cobalto profondo,
    #    cuore antracite con bottone bianco-azzurro. Palette fredda nuova.
    dict(P=4, sharp=0.45, amp2=0.0, P2=0, rot=0.78, maxr=0.30,
         inner=col(150, 215, 255), outer=col(30, 70, 200), core=col(25, 25, 45),
         coreR=0.20, dot=col(225, 245, 255),
         blooms=[(-0.12, 0.10, 1.02, 0.0),
                 (0.12, 0.10, 0.98, 0.8),
                 (0.0, -0.13, 1.05, 1.6)]),

    # 9) [MULTI] Coppia di camelie rosa-cipria: 2 blooms quasi concentrici a 6 petali tondi
    #    e larghi (sharp 0.55) -> fiore folto e SOVRAPPOSTO. Rosa cipria -> rosa intenso,
    #    cuore prugna chiaro. Palette delicata nuova.
    dict(P=6, sharp=0.55, amp2=0.0, P2=0, rot=0.0, maxr=0.35,
         inner=col(255, 205, 215), outer=col(225, 95, 150), core=col(140, 60, 110),
         coreR=0.16, dot=col(255, 230, 235),
         blooms=[(0.0, 0.0, 1.12, 0.0),
                 (0.06, -0.05, 0.80, 0.52)]),

    # 10) [MULTI] Duo di calendule oro-rame: 2 blooms a 6 petali larghi e tondi (sharp 0.60)
    #     affiancati che si SOVRAPPONGONO. Giallo oro -> rame caldo, cuore marrone-ambra.
    #     Palette calda nuova (diversa da tulipano/ibisco/cosmea).
    dict(P=6, sharp=0.60, amp2=0.0, P2=0, rot=0.15, maxr=0.33,
         inner=col(255, 215, 90), outer=col(205, 110, 35), core=col(110, 60, 25),
         coreR=0.18, dot=col(255, 240, 170),
         blooms=[(-0.11, 0.02, 1.04, 0.0),
                 (0.11, -0.02, 1.00, 0.55)]),

    # 11) [SINGOLO petali enormi] Bocca di leone smeraldo-turchese: 4 petali larghissimi
    #     (sharp 0.40) che si toccano/SOVRAPPONGONO. Verde smeraldo -> turchese profondo,
    #     cuore giallo-acido. Palette verde nuova.
    dict(P=4, sharp=0.40, amp2=0.0, P2=0, rot=0.4, maxr=0.47,
         inner=col(90, 230, 150), outer=col(20, 130, 140), core=col(230, 255, 60),
         coreR=0.13, dot=col(245, 255, 180)),

    # 12) [MULTI] Trio di gerbere ciclamino: 3 blooms a 7 petali larghi (sharp 0.55) sfalsati
    #     a triangolo che si SOVRAPPONGONO. Magenta-ciclamino -> viola scuro, cuore verde-acqua.
    #     Palette nuova (rosa freddo).
    dict(P=7, sharp=0.55, amp2=0.0, P2=0, rot=0.2, maxr=0.29,
         inner=col(255, 130, 200), outer=col(140, 25, 130), core=col(40, 160, 150),
         coreR=0.20, dot=col(190, 255, 230),
         blooms=[(-0.12, -0.06, 1.00, 0.0),
                 (0.12, -0.06, 0.97, 0.7),
                 (0.0, 0.15, 1.03, 1.4)]),

    # 13) [SINGOLO petali larghi] Ninfea lavanda: 7 petali ampi e tondi (sharp 0.62) che si
    #     SOVRAPPONGONO. Lavanda chiara -> blu-lavanda, cuore oro. Palette tenue nuova.
    dict(P=7, sharp=0.62, amp2=0.0, P2=0, rot=0.05, maxr=0.45,
         inner=col(225, 220, 255), outer=col(120, 110, 215), core=col(255, 195, 60),
         coreR=0.15, dot=col(255, 245, 200)),

    # 14) [MULTI] Coppia di dalie rosso-fuoco/oro: 2 blooms quasi concentrici a 8 petali larghi
    #     (sharp 0.65) -> fiore folto SOVRAPPOSTO. Rosso fuoco -> oro, cuore bordeaux.
    #     Palette calda intensa nuova.
    dict(P=8, sharp=0.65, amp2=0.0, P2=0, rot=0.0, maxr=0.37,
         inner=col(255, 90, 60), outer=col(255, 195, 70), core=col(110, 15, 30),
         coreR=0.15, dot=col(255, 235, 150),
         blooms=[(0.0, 0.0, 1.10, 0.0),
                 (0.05, 0.05, 0.78, 0.40)]),

    # 15) [SINGOLO petali enormi] Iris indaco-violetto: 6 petali larghi (sharp 0.48) che si
    #     SOVRAPPONGONO. Indaco -> violetto, cuore giallo-zafferano con bottone chiaro.
    #     Palette viola-blu nuova (diversa da clematide/ninfea).
    dict(P=6, sharp=0.48, amp2=0.0, P2=0, rot=0.5, maxr=0.46,
         inner=col(150, 120, 255), outer=col(55, 30, 160), core=col(255, 200, 40),
         coreR=0.14, dot=col(255, 235, 150)),

    # 16) [MULTI] Trio di ranuncoli pesca-albicocca: 3 blooms a 6 petali tondi e larghi
    #     (sharp 0.58) sfalsati a triangolo che si SOVRAPPONGONO. Pesca chiaro ->
    #     albicocca/arancio, cuore verde-oliva. Palette pastello calda nuova.
    dict(P=6, sharp=0.58, amp2=0.0, P2=0, rot=0.3, maxr=0.28,
         inner=col(255, 220, 180), outer=col(255, 150, 90), core=col(110, 120, 40),
         coreR=0.18, dot=col(255, 245, 215),
         blooms=[(-0.11, -0.08, 1.00, 0.0),
                 (0.11, -0.08, 0.98, 0.9),
                 (0.0, 0.14, 1.02, 1.8)]),

    # 17) [SINGOLO petali larghi] Fiore lime-ciano: 5 petali ampi (sharp 0.50) che si toccano
    #     e si SOVRAPPONGONO. Verde lime -> ciano elettrico, cuore magenta. Palette acida nuova;
    #     chiude il loop tornando al tulipano.
    dict(P=5, sharp=0.50, amp2=0.0, P2=0, rot=0.35, maxr=0.46,
         inner=col(200, 255, 90), outer=col(20, 200, 220), core=col(220, 40, 150),
         coreR=0.15, dot=col(245, 255, 180)),
]
NF = len(FLOWERS)

# Durata totale derivata: 4s per fiore (loop senza stacco).
DUR = SECS_PER_FLOWER * NF
N = int(FPS * DUR)


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

    # Crossfade morbido verso il prossimo fiore nella coda del segmento (loop: ultimo -> primo).
    if frac > (1.0 - FADE):
        w = (frac - (1.0 - FADE)) / FADE
        w = w * w * (3.0 - 2.0 * w)         # smoothstep
        nxt = render_flower(FLOWERS[(idx + 1) % NF], sway, breath)
        img = img * (1.0 - w) + nxt * w

    out.write(np.clip(img, 0.0, 255.0).astype(np.uint8).tobytes())

out.flush()
