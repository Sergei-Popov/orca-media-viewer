"""Renders the listing demo clip: spheres on a plain at sunset, a slow camera dolly past them and
a glowing lamp that pulses. A small ray tracer in numpy (sun and lamp with shadows, sky light,
one mirror bounce), adapted from Image Viewer's demo scene. Everything in the picture is made here.

It is deterministic and free of sampling noise, so the clip compresses well: sky light comes from
a fixed set of directions with an analytic occlusion term for the spheres, and each pixel averages
a fixed grid of rays.

    python3 tools/make-listing-clip.py [frames [width height [fps]]] > clip.rgb

Writes raw 8-bit RGB frames to stdout, one after another (the default: 288 frames of 1280×720,
12 s at 24 fps), for ffmpeg's `-f rawvideo -pix_fmt rgb24` input; progress goes to stderr.
tools/make-listing-samples.sh encodes them. Frames render in parallel, one process per core
(JOBS=… to change), in the same order they are written.
"""

import os

# One thread per process: the frames are already rendered in parallel.
for name in ('OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'MKL_NUM_THREADS'):
    os.environ.setdefault(name, '1')

import sys
from multiprocessing import Pool

import numpy as np

SUN = np.array([-0.36, 0.10, -1.0])
SUN /= np.linalg.norm(SUN)
SUN_RADIANCE = np.array([260.0, 170.0, 95.0])
SUN_IRRADIANCE = np.array([4.6, 3.3, 2.1])
LAMP = np.array([-0.15, 0.36, -4.3])
LAMP_RADIUS = 0.36
LAMP_EMISSION = np.array([16.0, 9.0, 4.2])
LAMP_POWER = np.array([5.0, 2.9, 1.3])

# Spheres: centre, radius, albedo, mirror reflectance (0 for matte).
SPHERES = [
    (np.array([-1.75, 1.0, -6.2]), 1.0, np.array([0.72, 0.30, 0.17]), 0.0),
    (np.array([0.75, 1.32, -7.7]), 1.32, np.array([0.9, 0.9, 0.92]), 0.92),
    (np.array([2.55, 0.62, -5.4]), 0.62, np.array([0.12, 0.47, 0.52]), 0.0),
    (np.array([1.35, 0.3, -4.1]), 0.3, np.array([0.85, 0.78, 0.32]), 0.0),
]

SAMPLES = 3  # SAMPLES × SAMPLES rays per pixel, on a fixed grid
SKY_DIRECTIONS = 256  # fixed directions that gather sky light


def sky(d, disk=True):
    """Radiance of the sky in directions d (n×3): a sunset gradient, a halo and the sun's disk."""
    up = np.clip(d[:, 1], -1, 1)
    t = np.clip(up, 0, 1) ** 0.45
    horizon = np.array([1.35, 0.55, 0.22])
    zenith = np.array([0.09, 0.15, 0.42])
    c = horizon * (1 - t)[:, None] + zenith * t[:, None]
    cos = np.clip(d @ SUN, -1, 1)
    angle = np.arccos(cos)
    c += np.array([3.2, 1.7, 0.7]) * np.exp(-angle * 9)[:, None]
    c += np.array([0.9, 0.45, 0.2]) * np.exp(-angle * 2.2)[:, None]
    if disk:
        c[angle < 0.028] = SUN_RADIANCE
    # Below the horizon (seen in reflections): the dusky far plain.
    c[up < 0] = np.array([0.32, 0.22, 0.16])
    return c


def fibonacci_sphere(count):
    """`count` directions spread evenly over the sphere."""
    i = np.arange(count) + 0.5
    y = 1 - 2 * i / count
    r = np.sqrt(1 - y * y)
    phi = np.pi * (3 - np.sqrt(5)) * i
    return np.stack([r * np.cos(phi), y, r * np.sin(phi)], axis=1)


DIRS = fibonacci_sphere(SKY_DIRECTIONS)
# What each direction brings: the sky above the horizon, nothing from the ground below it.
DIR_RADIANCE = np.where((DIRS[:, 1] > 0)[:, None], sky(DIRS, disk=False), 0.0)


def ground_albedo(p):
    """Plain warm sand: a texture would cost the listing images bytes and show little."""
    return np.broadcast_to(np.array([0.50, 0.40, 0.31]), p.shape).copy()


def intersect(o, d, skip_lamp=False):
    """Nearest hit: distance, object index (-1 sky, 0 ground, 1.. spheres, 99 lamp)."""
    n = len(o)
    best = np.full(n, np.inf)
    obj = np.full(n, -1)
    with np.errstate(divide='ignore', invalid='ignore'):
        t = -o[:, 1] / d[:, 1]
    hit = (t > 1e-4) & (d[:, 1] < 0)
    best[hit] = t[hit]
    obj[hit] = 0
    spheres = [(c, r) for c, r, _, _ in SPHERES] + ([] if skip_lamp else [(LAMP, LAMP_RADIUS)])
    for k, (c, r) in enumerate(spheres):
        oc = o - c
        b = np.einsum('ij,ij->i', oc, d)
        q = np.einsum('ij,ij->i', oc, oc) - r * r
        disc = b * b - q
        ok = disc > 0
        s = np.sqrt(np.where(ok, disc, 0))
        t = -b - s
        t = np.where(t > 1e-4, t, -b + s)
        hit = ok & (t > 1e-4) & (t < best)
        best[hit] = t[hit]
        obj[hit] = k + 1 if k < len(SPHERES) else 99
    return best, obj


def normal_at(p, obj):
    n = np.zeros_like(p)
    n[obj == 0] = [0, 1, 0]
    for k, (c, r, _, _) in enumerate(SPHERES):
        m = obj == k + 1
        n[m] = (p[m] - c) / r
    m = obj == 99
    n[m] = (p[m] - LAMP) / LAMP_RADIUS
    return n


def albedo_at(p, obj):
    a = np.zeros_like(p)
    m = obj == 0
    a[m] = ground_albedo(p[m])
    for k, (_, _, alb, _) in enumerate(SPHERES):
        a[obj == k + 1] = alb
    return a


def occluded(p, d, max_t):
    t, _ = intersect(p, d, skip_lamp=True)
    return t < max_t


def sky_light(p, n):
    """Light from the sky on surfaces at p facing n: a cosine-weighted sum over fixed directions,
    darkened where the spheres hide the sky (an analytic sphere occlusion term)."""
    weights = np.clip(n @ DIRS.T, 0, None)
    light = (weights @ DIR_RADIANCE) / np.maximum(weights.sum(axis=1, keepdims=True), 1e-9)
    occlusion = np.zeros(len(p))
    for c, r, _, _ in SPHERES:
        d = c - p
        dist = np.linalg.norm(d, axis=1)
        facing = np.einsum('ij,ij->i', n, d) / np.maximum(dist, 1e-9)
        occlusion += np.clip(facing, 0, None) * (r / np.maximum(dist, r)) ** 2
    return light * (1 - np.clip(occlusion, 0, 0.95))[:, None]


def shade_diffuse(p, n, alb, lamp_gain):
    """Sun, lamp and sky light on matte surfaces."""
    lit = np.zeros_like(p)
    ndl = np.clip(n @ SUN, 0, None)
    facing = ndl > 0
    sun_vis = np.zeros(len(p))
    if facing.any():
        sun_vis[facing] = ~occluded(p[facing] + n[facing] * 1e-3, np.broadcast_to(SUN, (facing.sum(), 3)), np.inf)
    lit += SUN_IRRADIANCE[None, :] * (ndl * sun_vis)[:, None]
    to = LAMP - p
    dist = np.linalg.norm(to, axis=1)
    ld = to / dist[:, None]
    ndl_l = np.clip(np.einsum('ij,ij->i', n, ld), 0, None)
    vis = ~occluded(p + n * 1e-3, ld, dist - LAMP_RADIUS)
    lit += lamp_gain * LAMP_POWER[None, :] * (ndl_l * vis / np.maximum(dist, LAMP_RADIUS) ** 2)[:, None]
    lit += sky_light(p, n) * 0.6
    return alb * lit


def trace(o, d, lamp_gain):
    t, obj = intersect(o, d)
    c = np.zeros((len(d), 3))
    sky_m = obj == -1
    c[sky_m] = sky(d[sky_m])
    c[obj == 99] = LAMP_EMISSION * lamp_gain
    p = o + d * np.where(np.isfinite(t), t, 0)[:, None]
    n = normal_at(p, obj)
    alb = albedo_at(p, obj)
    surf = (obj >= 0) & (obj != 99)
    mirror = np.zeros(len(d))
    for k, (_, _, _, refl) in enumerate(SPHERES):
        mirror[obj == k + 1] = refl
    matte = surf & (mirror == 0)
    if matte.any():
        c[matte] = shade_diffuse(p[matte], n[matte], alb[matte], lamp_gain)
    glossy = surf & (mirror > 0)
    if glossy.any():
        nd = np.einsum('ij,ij->i', d[glossy], n[glossy])
        r = d[glossy] - 2 * nd[:, None] * n[glossy]
        ro = p[glossy] + n[glossy] * 1e-3
        t2, obj2 = intersect(ro, r)
        c2 = np.zeros((len(r), 3))
        s2 = obj2 == -1
        c2[s2] = sky(r[s2])
        c2[obj2 == 99] = LAMP_EMISSION * lamp_gain
        h2 = (obj2 >= 0) & (obj2 != 99)
        if h2.any():
            p2 = ro[h2] + r[h2] * t2[h2][:, None]
            n2 = normal_at(p2, obj2[h2])
            c2[h2] = shade_diffuse(p2, n2, albedo_at(p2, obj2[h2]), lamp_gain)
        # A slightly warm metal with a Fresnel lift at grazing angles.
        fres = mirror[glossy] + (1 - mirror[glossy]) * (1 + nd) ** 5
        c[glossy] = c2 * fres[:, None] * np.array([1.0, 0.96, 0.9])
    return c


def camera(u):
    """The camera at u in [0, 1] of the clip: a slow dolly in and to the right, eased."""
    e = u * u * (3 - 2 * u)
    eye = np.array([-0.45, 1.28, 0.9]) * (1 - e) + np.array([0.3, 1.4, -0.6]) * e
    look = np.array([0.0, 1.33, -6.0]) * (1 - e) + np.array([0.3, 1.29, -6.0]) * e
    return eye, look


def lamp_gain(seconds):
    """The lamp breathes: three slow pulses in 12 s, never fully off."""
    return 0.55 + 0.45 * (0.5 - 0.5 * np.cos(2 * np.pi * seconds / 4))


def aces(x):
    v = x * 0.6
    return np.clip(v * (2.51 * v + 0.03) / (v * (2.43 * v + 0.59) + 0.14), 0, 1)


def oetf(v):
    return np.where(v <= 0.0031308, 12.92 * v, 1.055 * np.power(np.clip(v, 0, None), 1 / 2.4) - 0.055)


def render_frame(args):
    index, frames, width, height, fps = args
    eye, look = camera(index / max(1, frames - 1))
    gain = lamp_gain(index / fps)
    fwd = look - eye
    fwd /= np.linalg.norm(fwd)
    right = np.cross(fwd, [0, 1, 0])
    right /= np.linalg.norm(right)
    up = np.cross(right, fwd)
    fov = np.tan(np.radians(38) / 2)
    aspect = width / height
    out = np.zeros((height, width, 3), np.uint8)
    rows = 48
    for y0 in range(0, height, rows):
        h = min(rows, height - y0)
        yy, xx = np.mgrid[y0 : y0 + h, 0:width].astype(np.float64)
        acc = np.zeros((h * width, 3))
        for sy in range(SAMPLES):
            for sx in range(SAMPLES):
                px = (xx.ravel() + (sx + 0.5) / SAMPLES) / width * 2 - 1
                py = 1 - (yy.ravel() + (sy + 0.5) / SAMPLES) / height * 2
                d = fwd[None, :] + right[None, :] * (px * fov * aspect)[:, None] + up[None, :] * (py * fov)[:, None]
                d /= np.linalg.norm(d, axis=1, keepdims=True)
                o = np.broadcast_to(eye, d.shape)
                acc += trace(o, d, gain)
        linear = (acc / SAMPLES**2).reshape(h, width, 3)
        out[y0 : y0 + h] = (oetf(aces(linear)) * 255 + 0.5).astype(np.uint8)
    return out.tobytes()


def main():
    frames = int(sys.argv[1]) if len(sys.argv) > 1 else 288
    width = int(sys.argv[2]) if len(sys.argv) > 2 else 1280
    height = int(sys.argv[3]) if len(sys.argv) > 3 else 720
    fps = float(sys.argv[4]) if len(sys.argv) > 4 else 24.0
    jobs = int(os.environ.get('JOBS', os.cpu_count() or 1))
    stdout = sys.stdout.buffer
    work = [(i, frames, width, height, fps) for i in range(frames)]
    with Pool(jobs) as pool:
        for done, frame in enumerate(pool.imap(render_frame, work), 1):
            stdout.write(frame)
            print(f'\rframe {done}/{frames}', end='', file=sys.stderr, flush=True)
    stdout.flush()
    print(file=sys.stderr)


if __name__ == '__main__':
    main()
