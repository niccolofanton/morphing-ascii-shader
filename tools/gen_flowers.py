#!/usr/bin/env python3
# Genera un video RAW (rgb24) di un LOOP di 5 FIORI completamente diversi su SFONDO BIANCO.
# Ogni fiore differisce per numero di petali, forma (appuntita/tonda), armoniche e colori.
# Fra un fiore e il successivo c'e un CROSSFADE morbido; il 5o ritorna al 1o -> loop perfetto.
# Movimento lento (lieve oscillazione + "respiro"), periodico sull'intera durata.
# I frame vengono scritti su stdout e mandati in pipe a ffmpeg.
#
# Uso:
#   python3 tools/gen_flowers.py | ffmpeg -y -f rawvideo -pixel_format rgb24 \
#     -video_size 720x720 -framerate 30 -i - -c:v libx264 -profile:v high \
#     -pix_fmt yuv420p -an -movflags +faststart assets/video.mp4
#
# NB: su stdout devono finire SOLO i byte dei frame (eventuali messaggi -> stderr).

import sys
import math
import numpy as np

W = H = 720
FPS = 30
DUR = 20.0                 # secondi (loop senza stacco): 4s per fiore
N = int(FPS * DUR)
CX, CY = W / 2.0, H / 2.0
EDGE = 2.5                 # morbidezza bordi (px)
FADE = 0.22                # frazione di ogni segmento dedicata al crossfade verso il prossimo

yy, xx = np.mgrid[0:H, 0:W].astype(np.float64)
DX = xx - CX
DY = yy - CY
R = np.hypot(DX, DY)
ANG = np.arctan2(DY, DX)


def col(*rgb):
    return np.array(rgb, dtype=np.float64)


# 5 fiori COMPLETAMENTE DIVERSI: petali (P), forma (sharp: alto=appuntito), eventuale armonica
# secondaria (amp2/P2) per i "petali a strati", rotazione, dimensione (maxr in frazione di lato),
# colori (gradiente petalo inner->outer, cuore, bottone opzionale) e raggio del cuore.
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
]
NF = len(FLOWERS)


def soft(signed):
    # Bordo morbido (anti-alias): signed = (R - r); >0 = dentro la forma.
    return np.clip(signed / EDGE + 0.5, 0.0, 1.0)[..., None]


def render_flower(cfg, sway, breath):
    maxr = cfg['maxr'] * min(W, H)
    c = np.cos(cfg['P'] * (ANG + cfg['rot'] + sway))
    profile = (0.5 * (c + 1.0)) ** cfg['sharp']        # [0,1]: 0 tra i petali, 1 sulla punta
    if cfg['amp2'] > 0.0:
        profile = np.clip(profile + cfg['amp2'] * np.cos(cfg['P2'] * (ANG + cfg['rot'])), 0.0, 1.2)
    Rf = maxr * breath * profile                        # bordo del petalo per angolo
    petal = soft(Rf - R)

    grad = np.clip(R / maxr, 0.0, 1.0)[..., None]        # gradiente radiale del colore petalo
    pcol = cfg['inner'] * (1.0 - grad) + cfg['outer'] * grad

    img = np.full((H, W, 3), 255.0)                     # SFONDO BIANCO puro
    img = img * (1.0 - petal) + pcol * petal

    coreR = cfg['coreR'] * maxr * breath
    core = soft(coreR - R)
    img = img * (1.0 - core) + cfg['core'] * core

    if cfg['dot'] is not None:
        dot = soft(0.4 * coreR - R)
        img = img * (1.0 - dot) + cfg['dot'] * dot
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

    # Crossfade morbido verso il prossimo fiore nella coda del segmento (loop: 5o -> 1o).
    if frac > (1.0 - FADE):
        w = (frac - (1.0 - FADE)) / FADE
        w = w * w * (3.0 - 2.0 * w)         # smoothstep
        nxt = render_flower(FLOWERS[(idx + 1) % NF], sway, breath)
        img = img * (1.0 - w) + nxt * w

    out.write(np.clip(img, 0.0, 255.0).astype(np.uint8).tobytes())

out.flush()
