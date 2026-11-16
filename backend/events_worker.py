#!/usr/bin/env python3

import json
import logging
import os
import time

from pathlib import Path

import psycopg
from psycopg.types.json import Jsonb


SPOOL_DIR = Path("/var/lib/pbx-events")
POLL_INTERVAL = 2
MAX_FILE_SIZE = 1024 * 1024

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)

logger = logging.getLogger("pbx-events-worker")


def validate_event(record):
    from datetime import datetime
    from uuid import UUID

    event_definitions = {
        "FullyBooted": ("system", "info", "Asterisk fully booted"),
        "Shutdown": ("system", "critical", "Asterisk shutdown event"),
        "Reload": ("system", "warning", "Asterisk configuration or module reload"),
        "Alarm": ("system", "critical", "Asterisk alarm reported"),
        "AlarmClear": ("system", "info", "Asterisk alarm cleared"),
        "ContactStatus": ("sip", "warning", "PJSIP contact status changed"),
        "DeviceStateChange": ("sip", "info", "Device state changed"),
        "Newchannel": ("call", "info", "New call channel created"),
        "Newstate": ("call", "info", "Call channel state changed"),
        "DialBegin": ("call", "info", "Dial attempt started"),
        "DialEnd": ("call", "info", "Dial attempt completed"),
        "Hangup": ("call", "info", "Call channel hung up"),
        "BridgeEnter": ("call", "info", "Call channel entered bridge"),
        "BridgeLeave": ("call", "info", "Call channel left bridge"),
    }

    required = {
        "event_key", "event_type", "category", "severity",
        "summary", "details", "occurred_at", "is_alarm",
        "alarm_status",
    }

    if not isinstance(record, dict):
        raise ValueError("Invalid event structure")

    if not required.issubset(record):
        raise ValueError("Missing required event fields")

    event_type = record["event_type"]

    if event_type not in event_definitions:
        raise ValueError("Event type is not allowlisted")

    category, severity, summary = event_definitions[event_type]

    if record["category"] != category:
        raise ValueError("Invalid event category")

    if record["severity"] != severity:
        raise ValueError("Invalid event severity")

    if record["summary"] != summary:
        raise ValueError("Invalid event summary")

    if record.get("source") != "asterisk":
        raise ValueError("Invalid event source")

    try:
        UUID(record["event_key"])
    except (ValueError, TypeError, AttributeError):
        raise ValueError("Invalid event UUID")

    try:
        occurred_at = datetime.fromisoformat(
            record["occurred_at"].replace("Z", "+00:00")
        )
        if occurred_at.tzinfo is None:
            raise ValueError()
    except (ValueError, TypeError, AttributeError):
        raise ValueError("Invalid event timestamp")

    details = record["details"]

    if not isinstance(details, dict):
        raise ValueError("Invalid event details")

    if len(details) > 10:
        raise ValueError("Too many event detail fields")

    for key, value in details.items():
        if not isinstance(key, str) or not isinstance(value, str):
            raise ValueError("Invalid event detail value")
        if len(key) > 40 or len(value) > 120:
            raise ValueError("Event detail exceeds size limit")

    is_alarm = event_type in {"Alarm", "Shutdown"}

    if record["is_alarm"] is not is_alarm:
        raise ValueError("Invalid alarm state")

    expected_alarm_status = "active" if is_alarm else None

    if record["alarm_status"] != expected_alarm_status:
        raise ValueError("Invalid alarm status")

    return record


def process_file(path):
    if path.stat().st_size > MAX_FILE_SIZE:
        raise ValueError("Event file exceeds size limit")

    record = json.loads(path.read_text(encoding="utf-8"))
    record = validate_event(record)

    details = record["details"]

    with psycopg.connect() as conn:
        with conn.cursor() as cur:

            # Resolve only matching active alarms.
            if record["event_type"] == "AlarmClear":
                alarm_value = details.get("alarm")

                if alarm_value:
                    cur.execute(
                        """
                        UPDATE pbx_system_events
                        SET alarm_status = 'resolved',
                            resolved_at = NOW()
                        WHERE event_type = 'Alarm'
                          AND is_alarm = TRUE
                          AND alarm_status = 'active'
                          AND details->>'alarm' = %s
                        """,
                        (alarm_value,),
                    )

                    logger.info(
                        "AlarmClear matched active alarms: count=%s",
                        cur.rowcount,
                    )

            elif record["event_type"] == "FullyBooted":
                cur.execute(
                    """
                    UPDATE pbx_system_events
                    SET alarm_status = 'resolved',
                        resolved_at = NOW()
                    WHERE event_type = 'Shutdown'
                      AND is_alarm = TRUE
                      AND alarm_status = 'active'
                    """
                )

                if cur.rowcount:
                    logger.info(
                        "Asterisk boot completed; shutdown alarms resolved: count=%s",
                        cur.rowcount,
                    )

            cur.execute(
                """
                INSERT INTO pbx_system_events (
                    event_key,
                    event_type,
                    category,
                    severity,
                    source,
                    summary,
                    details,
                    occurred_at,
                    is_alarm,
                    alarm_status
                )
                VALUES (
                    %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s
                )
                ON CONFLICT (event_key) DO NOTHING
                """,
                (
                    record["event_key"],
                    record["event_type"],
                    record["category"],
                    record["severity"],
                    record.get("source", "asterisk"),
                    record["summary"],
                    Jsonb(details),
                    record["occurred_at"],
                    record["is_alarm"],
                    record["alarm_status"],
                ),
            )

    # Reached only after the database transaction commits.
    path.unlink()

    logger.info(
        "Processed event: type=%s key=%s",
        record["event_type"],
        record["event_key"],
    )


def run():
    logger.info("Event ingestion worker started")

    while True:
        try:
            files = sorted(SPOOL_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime_ns)

            for path in files:
                try:
                    process_file(path)

                except Exception as exc:
                    logger.error(
                        "Event processing failed: file=%s error=%s",
                        path.name,
                        type(exc).__name__,
                    )

                    # Keep the failed file for a later retry.
                    time.sleep(POLL_INTERVAL)

        except Exception as exc:
            logger.error(
                "Worker cycle failed: error=%s",
                type(exc).__name__,
            )

        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    run()
