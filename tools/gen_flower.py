#!/usr/bin/env python3
# Genera un video RAW (rgb24) di un FIORE organico colorato su SFONDO BIANCO,
# con movimento LENTO e loop perfetto (ogni animazione e periodica sull'intera durata).
# I frame vengono scritti su stdout e inviati in pipe a ffmpeg per la codifica h264.
#
# Uso:
#   python3 tools/gen_flower.py | ffmpeg -y -f rawvideo -pixel_format rgb24 \
#     -video_size 720x720 -framerate 30 -i - -c:v libx264 -profile:v high \
#     -pix_fmt yuv420p -an -movflags +faststart assets/video.mp4
#
# NB: su stdout devono finire SOLO i byte dei frame (eventuali messaggi -> stderr).

import sys
import math
import numpy as np

W = H = 720
FPS = 30
DUR = 16.0                 # secondi (loop senza stacco)
N = int(FPS * DUR)
CX, CY = W / 2.0, H / 2.0
MAXR = min(W, H) * 0.42    # estensione del fiore
P = 6                      # numero di petali
EDGE = 2.5                 # morbidezza bordi (px): bordo dolce, adatto all'ASCII

# Palette: petali caldi arancio/corallo con gradiente radiale, cuore blu/viola.
PETAL_INNER = np.array([245.0, 186.0, 96.0])   # arancio chiaro (verso il centro)
PETAL_OUTER = np.array([231.0, 104.0, 38.0])   # arancio intenso (punta petalo)
CORE_COL    = np.array([66.0, 46.0, 120.0])    # viola/blu (cuore)
CORE_DOT    = np.array([250.0, 210.0, 110.0])  # bottone caldo al centro

yy, xx = np.mgrid[0:H, 0:W].astype(np.float64)
dx = xx - CX
dy = yy - CY
r = np.hypot(dx, dy)
ang = np.arctan2(dy, dx)
grad = np.clip(r / MAXR, 0.0, 1.0)[..., None]               # 0..1 dal centro al bordo
pcol = PETAL_INNER * (1.0 - grad) + PETAL_OUTER * grad      # colore petalo per pixel


def soft(signed):
    # Bordo morbido (anti-alias): signed = (R - r); >0 = dentro la forma.
    return np.clip(signed / EDGE + 0.5, 0.0, 1.0)[..., None]


out = sys.stdout.buffer
for n in range(N):
    ph = 2.0 * math.pi * (n / N)            # fase di loop (0..2pi) -> frame N == frame 0
    sway = 0.30 * math.sin(ph)              # lieve oscillazione rotatoria (lenta)
    bloom = 1.0 + 0.05 * math.sin(ph)       # lieve "respiro"
    wob = 0.06 * math.cos(2.0 * ph)         # piccola asimmetria organica

    # Bordo del fiore in funzione dell'angolo: 6 petali smerlati + leggera asimmetria.
    Rf = MAXR * bloom * (0.55 + 0.45 * np.cos(P * (ang + sway)) + wob * np.cos((P + 1) * ang))
    petal = soft(Rf - r)

    core = soft(0.20 * MAXR * bloom - r)
    dot = soft(0.085 * MAXR * bloom - r)

    img = np.full((H, W, 3), 255.0)         # sfondo BIANCO puro
    img = img * (1.0 - petal) + pcol * petal
    img = img * (1.0 - core) + CORE_COL * core
    img = img * (1.0 - dot) + CORE_DOT * dot

    out.write(np.clip(img, 0.0, 255.0).astype(np.uint8).tobytes())

out.flush()
