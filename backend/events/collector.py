#!/usr/bin/env python3

import json
import logging
import os
import socket
import time
import uuid

from datetime import datetime, timezone
from pathlib import Path

AMI_HOST = "127.0.0.1"
AMI_PORT = 5038
AMI_USERNAME = "pbx_monitor"
AMI_SECRET_FILE = Path("/etc/pbx-events/ami-secret")

SPOOL_DIR = Path("/var/lib/pbx-events")
EVENT_MASK = "system,call,reporting"

MAX_FRAME_SIZE = 65536
MAX_FIELD_LENGTH = 120
MAX_PENDING_EVENTS = 10000
MAX_PENDING_BYTES = 50 * 1024 * 1024

ALLOWED_EVENTS = {
    "FullyBooted": ("system", "info"),
    "Shutdown": ("system", "critical"),
    "Reload": ("system", "warning"),
    "Alarm": ("system", "critical"),
    "AlarmClear": ("system", "info"),
    "ContactStatus": ("sip", "warning"),
    "DeviceStateChange": ("sip", "info"),
    "Newchannel": ("call", "info"),
    "Newstate": ("call", "info"),
    "DialBegin": ("call", "info"),
    "DialEnd": ("call", "info"),
    "Hangup": ("call", "info"),
    "BridgeEnter": ("call", "info"),
    "BridgeLeave": ("call", "info"),
}

SAFE_FIELDS = {
    "ContactStatus": {
        "EndpointName", "AOR", "ContactStatus"
    },
    "DeviceStateChange": {
        "Device", "State"
    },
    "Newchannel": {
        "ChannelStateDesc", "Context", "Priority"
    },
    "Newstate": {
        "ChannelStateDesc"
    },
    "DialBegin": {
        "DialStatus"
    },
    "DialEnd": {
        "DialStatus"
    },
    "Hangup": {
        "Cause", "Cause-txt"
    },
    "BridgeEnter": {
        "BridgeType", "BridgeTechnology"
    },
    "BridgeLeave": {
        "BridgeType", "BridgeTechnology"
    },
    "Alarm": {
        "Alarm"
    },
    "AlarmClear": {
        "Alarm"
    },
    "Reload": {
        "Module"
    },
    "FullyBooted": set(),
    "Shutdown": set(),
}

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)

logger = logging.getLogger("pbx-events")


class CollectorError(Exception):
    pass


def utc_now():
    return datetime.now(timezone.utc)


def read_secret():
    secret = AMI_SECRET_FILE.read_text(
        encoding="utf-8"
    ).strip()

    if not secret:
        raise CollectorError("AMI credential is empty")

    return secret


def receive_frame(sock, buffer):
    while b"\r\n\r\n" not in buffer:
        chunk = sock.recv(4096)

        if not chunk:
            raise CollectorError("AMI connection closed")

        buffer += chunk

        if len(buffer) > MAX_FRAME_SIZE:
            raise CollectorError("AMI frame too large")

    raw, buffer = buffer.split(b"\r\n\r\n", 1)
    fields = {}

    for line in raw.decode(
        "utf-8", errors="replace"
    ).split("\r\n"):

        if ": " in line:
            key, value = line.split(": ", 1)
            fields[key] = value

    return fields, buffer


def sanitize_event(event):
    event_type = event.get("Event")

    if event_type not in ALLOWED_EVENTS:
        return None

    category, severity = ALLOWED_EVENTS[event_type]
    details = {}

    for field in SAFE_FIELDS[event_type]:
        value = event.get(field)

        if value is None:
            continue

        value = str(value).strip()

        if value:
            details[field.lower()] = value[:MAX_FIELD_LENGTH]

    summary_map = {
        "FullyBooted": "Asterisk fully booted",
        "Shutdown": "Asterisk shutdown event",
        "Reload": "Asterisk configuration or module reload",
        "Alarm": "Asterisk alarm reported",
        "AlarmClear": "Asterisk alarm cleared",
        "ContactStatus": "PJSIP contact status changed",
        "DeviceStateChange": "Device state changed",
        "Newchannel": "New call channel created",
        "Newstate": "Call channel state changed",
        "DialBegin": "Dial attempt started",
        "DialEnd": "Dial attempt completed",
        "Hangup": "Call channel hung up",
        "BridgeEnter": "Call channel entered bridge",
        "BridgeLeave": "Call channel left bridge",
    }

    is_alarm = event_type in {"Alarm", "Shutdown"}

    return {
        "event_key": str(uuid.uuid4()),
        "event_type": event_type,
        "category": category,
        "severity": severity,
        "source": "asterisk",
        "summary": summary_map[event_type],
        "details": details,
        "occurred_at": utc_now().isoformat(),
        "is_alarm": is_alarm,
        "alarm_status": "active" if is_alarm else None,
    }


def pending_spool_usage():
    count = 0
    total_bytes = 0

    for path in SPOOL_DIR.glob("*.json"):
        try:
            total_bytes += path.stat().st_size
            count += 1
        except FileNotFoundError:
            continue

    return count, total_bytes


def append_event(record):
    SPOOL_DIR.mkdir(
        parents=True,
        exist_ok=True,
    )

    count, total_bytes = pending_spool_usage()

    if count >= MAX_PENDING_EVENTS:
        raise CollectorError("Pending event count limit reached")

    if total_bytes >= MAX_PENDING_BYTES:
        raise CollectorError("Pending event storage limit reached")

    event_key = record["event_key"]
    final_path = SPOOL_DIR / f"{event_key}.json"
    temporary_path = SPOOL_DIR / f".{event_key}.tmp"

    encoded = json.dumps(
        record,
        ensure_ascii=True,
        separators=(",", ":"),
    )

    if len(encoded.encode("utf-8")) + total_bytes > MAX_PENDING_BYTES:
        raise CollectorError("Event spool capacity reached")

    with temporary_path.open("x", encoding="utf-8") as handle:
        handle.write(encoded)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())

    os.replace(temporary_path, final_path)

    logger.info(
        "Event spooled: type=%s category=%s",
        record["event_type"],
        record["category"],
    )


def connect_ami():
    sock = socket.create_connection(
        (AMI_HOST, AMI_PORT),
        timeout=10,
    )

    sock.settimeout(None)

    banner = sock.recv(1024)

    if b"Asterisk Call Manager" not in banner:
        sock.close()
        raise CollectorError("Unexpected AMI banner")

    login = (
        "Action: Login\r\n"
        f"Username: {AMI_USERNAME}\r\n"
        f"Secret: {read_secret()}\r\n"
        "Events: off\r\n\r\n"
    )

    sock.sendall(login.encode("utf-8"))

    buffer = b""
    response, buffer = receive_frame(sock, buffer)

    if response.get("Response") != "Success":
        sock.close()
        raise CollectorError("AMI authentication failed")

    subscription = (
        "Action: Events\r\n"
        f"EventMask: {EVENT_MASK}\r\n\r\n"
    )

    sock.sendall(subscription.encode("utf-8"))

    response, buffer = receive_frame(sock, buffer)

    if response.get("Response") != "Success":
        sock.close()
        raise CollectorError("AMI event subscription failed")

    logger.info("AMI connection and restricted subscription active")

    return sock, buffer


def run():
    while True:
        sock = None

        try:
            sock, buffer = connect_ami()

            while True:
                event, buffer = receive_frame(sock, buffer)

                event_type = event.get("Event")

                if not event_type:
                    continue

                record = sanitize_event(event)

                if record:
                    append_event(record)

        except Exception as exc:
            logger.error(
                "Collector error: %s",
                type(exc).__name__,
            )

        finally:
            if sock:
                try:
                    sock.sendall(b"Action: Logoff\r\n\r\n")
                except OSError:
                    pass

                sock.close()

        time.sleep(5)


if __name__ == "__main__":
    run()
