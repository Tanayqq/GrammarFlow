"""Bridge head tracking from OpenTrack UDP to GrammarFlow's hands-free pointer.

Any app that sends OpenTrack UDP works, for example GalaxyBudsClient (Galaxy Buds
head tracking: Spatial audio page > enable "OpenTrack" broadcasting) or OpenTrack itself.

    python helpers/head_bridge.py

Listens for OpenTrack packets on 127.0.0.1:4242 and serves them to the editor on
ws://127.0.0.1:18765 as {"yaw": deg, "pitch": deg} (yaw positive = left). Standard library only.
"""
import asyncio, base64, hashlib, json, struct, sys

UDP_PORT, WS_PORT = 4242, 18765
# Only these pages may read head motion; add your own origin as an argument.
ALLOWED_ORIGINS = {"https://grammarflowt.vercel.app", "https://grammarflow-brain.onrender.com",
                   "http://localhost:3000", *sys.argv[1:]}
clients = set()


def opentrack_to_pose(packet):
    """6 little-endian doubles: x, y, z (cm), yaw (deg, right +), pitch (deg), roll (deg)."""
    if len(packet) != 48:
        return None
    _, _, _, yaw, pitch, _ = struct.unpack("<6d", packet)
    return {"yaw": -yaw, "pitch": pitch}


def ws_frame(text):
    data = text.encode()
    head = bytes([0x81, len(data)]) if len(data) < 126 else struct.pack("!BBH", 0x81, 126, len(data))
    return head + data


async def ws_client(reader, writer):
    try:
        request = (await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), 5)).decode("latin-1")
        headers = {k.strip().lower(): v.strip() for k, _, v in (l.partition(":") for l in request.split("\r\n")[1:]) if k}
        key, origin = headers.get("sec-websocket-key"), headers.get("origin", "")
        allowed = origin in ALLOWED_ORIGINS or origin.startswith(("http://localhost:", "http://127.0.0.1:"))
        if not key or not allowed:
            writer.write(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n")
            return
        accept = base64.b64encode(hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest()).decode()
        writer.write(f"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                     f"Sec-WebSocket-Accept: {accept}\r\n\r\n".encode())
        clients.add(writer)
        print(f"Editor connected from {origin}")
        await reader.read()  # client frames are ignored; returns when the page closes
    except (asyncio.IncompleteReadError, asyncio.TimeoutError, ConnectionError):
        pass
    finally:
        clients.discard(writer)
        writer.close()


class OpenTrackReceiver(asyncio.DatagramProtocol):
    def datagram_received(self, packet, _addr):
        pose = opentrack_to_pose(packet)
        if pose:
            frame = ws_frame(json.dumps(pose))
            for w in list(clients):
                w.write(frame)


async def main():
    loop = asyncio.get_running_loop()
    await loop.create_datagram_endpoint(OpenTrackReceiver, local_addr=("127.0.0.1", UDP_PORT))
    server = await asyncio.start_server(ws_client, "127.0.0.1", WS_PORT)
    print(f"Head bridge ready: OpenTrack UDP 127.0.0.1:{UDP_PORT} -> ws://127.0.0.1:{WS_PORT}", flush=True)
    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
