"""binary_vdf.py — minimal reader for Steam's binary VDF format
(shortcuts.vdf). Ported from decky-proton-launch's own vdf.py (already
proven working there), read-only subset only — this plugin never writes
shortcuts.vdf itself (see steam_shortcuts.py's own note on why)."""
import struct
from typing import List, Tuple

import decky


def read_binary(data: bytes, pos: int) -> Tuple[List, int]:
    nodes = []
    length = len(data)
    while pos < length:
        tag = data[pos]
        pos += 1
        if tag == 0x08:
            return nodes, pos
        nul = data.index(b"\x00", pos)
        key = data[pos:nul].decode("utf-8", errors="replace")
        pos = nul + 1
        if tag == 0x00:
            children, pos = read_binary(data, pos)
            nodes.append((0x00, key, children))
        elif tag == 0x01:
            nul = data.index(b"\x00", pos)
            value = data[pos:nul].decode("utf-8", errors="replace")
            pos = nul + 1
            nodes.append((0x01, key, value))
        elif tag == 0x02:
            value = struct.unpack("<i", data[pos:pos + 4])[0]
            pos += 4
            nodes.append((0x02, key, value))
        elif tag == 0x07:
            value = struct.unpack("<Q", data[pos:pos + 8])[0]
            pos += 8
            nodes.append((0x07, key, value))
        else:
            decky.logger.warning(f"[bvdf] unknown tag {tag:#04x} at pos {pos - 1}")
            return nodes, pos
    return nodes, pos
