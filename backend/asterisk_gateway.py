import json
import socket

SOCKET_PATH = "/run/pbx-gateway/asterisk.sock"
SOCKET_TIMEOUT = 15


class GatewayError(Exception):
    pass


def gateway_request(operation: str) -> dict:
    if operation not in {
        "status",
        "settings",
        "channels",
        "endpoints",
    }:
        raise GatewayError("Operation not permitted")

    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
            client.settimeout(SOCKET_TIMEOUT)
            client.connect(SOCKET_PATH)

            request = json.dumps(
                {"operation": operation}
            ) + "\n"

            client.sendall(request.encode("utf-8"))

            response = b""

            while not response.endswith(b"\n"):
                chunk = client.recv(8192)

                if not chunk:
                    raise GatewayError("Gateway closed connection")

                response += chunk

                if len(response) > 65536:
                    raise GatewayError("Gateway response too large")

            result = json.loads(response.decode("utf-8"))

            if not isinstance(result, dict) or not result.get("success"):
                raise GatewayError("Gateway monitoring request failed")

            return result

    except (OSError, json.JSONDecodeError) as exc:
        raise GatewayError("Asterisk monitoring gateway unavailable") from exc
