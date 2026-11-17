"""Tiny QR code encoder (standard library only): byte mode, error correction level M, versions 1-5.

Enough for booking pass codes (up to 84 characters). make_matrix() returns rows of 0/1, to_svg() an inline SVG.
"""

# version: (data codewords per block, EC codewords per block, number of blocks, alignment centre)
_VERSIONS = {1: (16, 10, 1, None), 2: (28, 16, 1, 18), 3: (44, 26, 1, 22), 4: (32, 18, 2, 26), 5: (43, 24, 2, 30)}

_EXP, _LOG = [0] * 512, [0] * 256
_x = 1
for _i in range(255):
    _EXP[_i], _LOG[_x] = _x, _i
    _x <<= 1
    if _x & 0x100:
        _x ^= 0x11D
for _i in range(255, 512):
    _EXP[_i] = _EXP[_i - 255]


def _mul(a, b):
    return 0 if a == 0 or b == 0 else _EXP[_LOG[a] + _LOG[b]]


def _rs_remainder(data, ec_len):
    gen = [1]
    for i in range(ec_len):                      # generator polynomial (x - a^0)...(x - a^(n-1))
        nxt = [0] * (len(gen) + 1)
        for j, c in enumerate(gen):
            nxt[j] ^= c
            nxt[j + 1] ^= _mul(c, _EXP[i])
        gen = nxt
    rem = [0] * ec_len
    for byte in data:
        factor = byte ^ rem[0]
        rem = rem[1:] + [0]
        for i in range(ec_len):
            rem[i] ^= _mul(gen[i + 1], factor)
    return rem


def _codewords(payload, version):
    data_len, ec_len, blocks, _ = _VERSIONS[version]
    capacity = data_len * blocks
    bits = "0100" + format(len(payload), "08b") + "".join(format(b, "08b") for b in payload)
    bits += "0" * min(4, capacity * 8 - len(bits))
    bits += "0" * (-len(bits) % 8)
    words = [int(bits[i:i + 8], 2) for i in range(0, len(bits), 8)]
    pad = (0xEC, 0x11)
    while len(words) < capacity:
        words.append(pad[(len(words) - len(bits) // 8) % 2])
    chunks = [words[i * data_len:(i + 1) * data_len] for i in range(blocks)]
    ecs = [_rs_remainder(c, ec_len) for c in chunks]
    out = [c[i] for i in range(data_len) for c in chunks]
    out += [e[i] for i in range(ec_len) for e in ecs]
    return out


def _format_bits(mask):
    data = (0b00 << 3) | mask                    # level M = 00
    rem = data << 10
    for i in range(4, -1, -1):
        if rem & (1 << (i + 10)):
            rem ^= 0x537 << i
    return ((data << 10) | rem) ^ 0x5412


def _build(version, words, mask):
    size = 17 + 4 * version
    m = [[0] * size for _ in range(size)]
    fn = [[False] * size for _ in range(size)]   # function pattern modules (not data)

    def put(r, c, v):
        m[r][c] = v
        fn[r][c] = True

    def finder(r0, c0):
        for dr in range(-1, 8):
            for dc in range(-1, 8):
                r, c = r0 + dr, c0 + dc
                if 0 <= r < size and 0 <= c < size:
                    on = 0 <= dr <= 6 and 0 <= dc <= 6 and (dr in (0, 6) or dc in (0, 6) or (2 <= dr <= 4 and 2 <= dc <= 4))
                    put(r, c, 1 if on else 0)

    finder(0, 0), finder(0, size - 7), finder(size - 7, 0)
    for i in range(8, size - 8):
        put(6, i, 1 - i % 2)
        put(i, 6, 1 - i % 2)
    centre = _VERSIONS[version][3]
    if centre:
        for dr in range(-2, 3):
            for dc in range(-2, 3):
                put(centre + dr, centre + dc, 1 if max(abs(dr), abs(dc)) != 1 else 0)
    put(size - 8, 8, 1)                          # dark module
    fmt = _format_bits(mask)
    for i in range(15):
        bit = (fmt >> i) & 1
        if i < 6:
            r1, c1 = i, 8
        elif i < 8:
            r1, c1 = i + 1, 8
        elif i == 8:
            r1, c1 = 8, 7
        else:
            r1, c1 = 8, 14 - i
        put(r1, c1, bit)
        if i < 8:
            put(8, size - 1 - i, bit)
        else:
            put(size - 15 + i, 8, bit)
    put(size - 8, 8, 1)

    bits = [(w >> s) & 1 for w in words for s in range(7, -1, -1)]
    idx, up, c = 0, True, size - 1
    while c > 0:
        if c == 6:
            c -= 1
        rows = range(size - 1, -1, -1) if up else range(size)
        for r in rows:
            for cc in (c, c - 1):
                if not fn[r][cc]:
                    bit = bits[idx] if idx < len(bits) else 0
                    idx += 1
                    inv = [(r + cc) % 2 == 0, r % 2 == 0, cc % 3 == 0, (r + cc) % 3 == 0,
                           (r // 2 + cc // 3) % 2 == 0, (r * cc) % 2 + (r * cc) % 3 == 0,
                           ((r * cc) % 2 + (r * cc) % 3) % 2 == 0, ((r + cc) % 2 + (r * cc) % 3) % 2 == 0][mask]
                    m[r][cc] = bit ^ (1 if inv else 0)
        up = not up
        c -= 2
    return m


def _penalty(m):
    size, score = len(m), 0
    for grid in (m, [list(col) for col in zip(*m)]):
        for row in grid:
            run = 1
            for i in range(1, size):
                if row[i] == row[i - 1]:
                    run += 1
                    if run == 5:
                        score += 3
                    elif run > 5:
                        score += 1
                else:
                    run = 1
            s = "".join(map(str, row))
            score += 40 * (s.count("10111010000") + s.count("00001011101"))
    for r in range(size - 1):
        for c in range(size - 1):
            if m[r][c] == m[r][c + 1] == m[r + 1][c] == m[r + 1][c + 1]:
                score += 3
    dark = sum(map(sum, m)) * 100 // (size * size)
    return score + abs(dark - 50) // 5 * 10


def make_matrix(text):
    payload = text.encode("utf-8")
    for version in sorted(_VERSIONS):
        data_len, _, blocks, _ = _VERSIONS[version]
        if len(payload) <= data_len * blocks - 2:
            break
    else:
        raise ValueError("Text too long for this QR encoder (max 84 bytes).")
    words = _codewords(payload, version)
    return min((_build(version, words, mask) for mask in range(8)), key=_penalty)


def to_svg(text, scale=4, border=4):
    m = make_matrix(text)
    size = len(m) + 2 * border
    path = "".join(f"M{c + border},{r + border}h1v1h-1z" for r, row in enumerate(m) for c, v in enumerate(row) if v)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" width="{size * scale}" '
            f'height="{size * scale}" shape-rendering="crispEdges" role="img" aria-label="QR code {text}">'
            f'<rect width="100%" height="100%" fill="#fff"/><path d="{path}" fill="#000"/></svg>')
