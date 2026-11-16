import os

from datetime import datetime, timedelta, timezone

import psycopg
from psycopg.rows import dict_row
from fastapi import APIRouter, HTTPException, Query


router = APIRouter(tags=["System Events"])

EVENT_TYPES = {
    "FullyBooted", "Shutdown", "Reload", "Alarm", "AlarmClear",
    "ContactStatus", "DeviceStateChange", "Newchannel", "Newstate",
    "DialBegin", "DialEnd", "Hangup", "BridgeEnter", "BridgeLeave",
}

CATEGORIES = {"system", "sip", "call"}
SEVERITIES = {"info", "warning", "critical"}


def get_connection():
    try:
        return psycopg.connect(
            host=os.environ["PGHOST"],
            dbname=os.environ["PGDATABASE"],
            user=os.environ["PGUSER"],
            password=os.environ["PGPASSWORD"],
            connect_timeout=5,
            row_factory=dict_row,
        )
    except Exception:
        raise HTTPException(503, "System events database unavailable")


def validate_filters(category, severity, event_type):
    if category and category not in CATEGORIES:
        raise HTTPException(400, "Invalid event category")

    if severity and severity not in SEVERITIES:
        raise HTTPException(400, "Invalid event severity")

    if event_type and event_type not in EVENT_TYPES:
        raise HTTPException(400, "Invalid event type")


def build_filters(category=None, severity=None, event_type=None):
    conditions = []
    params = []

    if category:
        conditions.append("category = %s")
        params.append(category)

    if severity:
        conditions.append("severity = %s")
        params.append(severity)

    if event_type:
        conditions.append("event_type = %s")
        params.append(event_type)

    where = " WHERE " + " AND ".join(conditions) if conditions else ""

    return where, params


@router.get("/api/events")
def list_events(
    page: int = Query(1, ge=1, le=1000000),
    page_size: int = Query(25, ge=1, le=100),
    category: str | None = None,
    severity: str | None = None,
    event_type: str | None = None,
):
    validate_filters(category, severity, event_type)

    where, params = build_filters(category, severity, event_type)
    offset = (page - 1) * page_size

    try:
        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    f"SELECT COUNT(*) AS total FROM pbx_system_events{where}",
                    params,
                )
                total = cursor.fetchone()["total"]

                cursor.execute(
                    f"""
                    SELECT id, event_key, event_type, category, severity,
                           source, summary, details, occurred_at, received_at,
                           is_alarm, alarm_status, resolved_at
                    FROM pbx_system_events
                    {where}
                    ORDER BY occurred_at DESC, id DESC
                    LIMIT %s OFFSET %s
                    """,
                    params + [page_size, offset],
                )
                items = cursor.fetchall()

        return {
            "items": items,
            "pagination": {
                "page": page,
                "page_size": page_size,
                "total": total,
                "pages": (total + page_size - 1) // page_size,
            },
        }

    except HTTPException:
        raise
    except Exception:
        raise HTTPException(503, "Unable to retrieve system events")


@router.get("/api/events/summary")
def events_summary():
    since = datetime.now(timezone.utc) - timedelta(hours=24)

    try:
        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT
                        COUNT(*) AS total_events,
                        COUNT(*) FILTER (
                            WHERE occurred_at >= %s
                        ) AS events_last_24h,
                        COUNT(*) FILTER (
                            WHERE severity = 'warning'
                        ) AS warnings,
                        COUNT(*) FILTER (
                            WHERE severity = 'critical'
                        ) AS critical_events,
                        COUNT(*) FILTER (
                            WHERE category = 'system'
                        ) AS system_events,
                        COUNT(*) FILTER (
                            WHERE category = 'sip'
                        ) AS sip_events,
                        COUNT(*) FILTER (
                            WHERE category = 'call'
                        ) AS call_events
                    FROM pbx_system_events
                    """,
                    (since,),
                )
                totals = cursor.fetchone()

                cursor.execute(
                    """
                    SELECT severity, COUNT(*) AS total
                    FROM pbx_system_events
                    GROUP BY severity
                    ORDER BY severity
                    """
                )
                by_severity = cursor.fetchall()

                cursor.execute(
                    """
                    SELECT category, COUNT(*) AS total
                    FROM pbx_system_events
                    GROUP BY category
                    ORDER BY category
                    """
                )
                by_category = cursor.fetchall()

        return {
            "totals": totals,
            "by_severity": by_severity,
            "by_category": by_category,
        }

    except Exception:
        raise HTTPException(503, "Unable to retrieve event summary")


@router.get("/api/alarms")
def active_alarms(
    page: int = Query(1, ge=1, le=1000000),
    page_size: int = Query(25, ge=1, le=100),
):
    offset = (page - 1) * page_size

    try:
        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT COUNT(*) AS total
                    FROM pbx_system_events
                    WHERE is_alarm = TRUE
                      AND alarm_status = 'active'
                    """
                )
                total = cursor.fetchone()["total"]

                cursor.execute(
                    """
                    SELECT id, event_key, event_type, category, severity,
                           summary, details, occurred_at, received_at,
                           alarm_status
                    FROM pbx_system_events
                    WHERE is_alarm = TRUE
                      AND alarm_status = 'active'
                    ORDER BY
                        CASE severity
                            WHEN 'critical' THEN 1
                            WHEN 'warning' THEN 2
                            ELSE 3
                        END,
                        occurred_at DESC
                    LIMIT %s OFFSET %s
                    """,
                    (page_size, offset),
                )
                items = cursor.fetchall()

        return {
            "items": items,
            "pagination": {
                "page": page,
                "page_size": page_size,
                "total": total,
                "pages": (total + page_size - 1) // page_size,
            },
        }

    except Exception:
        raise HTTPException(503, "Unable to retrieve active alarms")


@router.get("/api/alarms/history")
def alarm_history(
    page: int = Query(1, ge=1, le=1000000),
    page_size: int = Query(25, ge=1, le=100),
    status: str | None = None,
):
    if status and status not in {"active", "resolved"}:
        raise HTTPException(400, "Invalid alarm status")

    conditions = ["is_alarm = TRUE"]
    params = []

    if status:
        conditions.append("alarm_status = %s")
        params.append(status)

    where = " WHERE " + " AND ".join(conditions)
    offset = (page - 1) * page_size

    try:
        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    f"""
                    SELECT COUNT(*) AS total
                    FROM pbx_system_events
                    {where}
                    """,
                    params,
                )
                total = cursor.fetchone()["total"]

                cursor.execute(
                    f"""
                    SELECT id, event_key, event_type, category, severity,
                           summary, details, occurred_at, received_at,
                           alarm_status, resolved_at
                    FROM pbx_system_events
                    {where}
                    ORDER BY occurred_at DESC, id DESC
                    LIMIT %s OFFSET %s
                    """,
                    params + [page_size, offset],
                )
                items = cursor.fetchall()

        return {
            "items": items,
            "pagination": {
                "page": page,
                "page_size": page_size,
                "total": total,
                "pages": (total + page_size - 1) // page_size,
            },
        }

    except Exception:
        raise HTTPException(503, "Unable to retrieve alarm history")
