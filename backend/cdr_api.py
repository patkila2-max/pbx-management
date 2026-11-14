import os
from datetime import date, datetime, time, timedelta, timezone

import psycopg
from psycopg.rows import dict_row
from fastapi import APIRouter, HTTPException, Query

router = APIRouter(prefix="/api/cdr", tags=["CDR"])

SORT_COLUMNS = {
    "start_time": "start_time",
    "duration": "duration",
    "disposition": "disposition",
    "src": "src",
    "dst": "dst",
}

DISPOSITIONS = {
    "ANSWERED",
    "NO ANSWER",
    "BUSY",
    "FAILED",
    "CONGESTION",
}


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
        raise HTTPException(
            status_code=503,
            detail="CDR database unavailable",
        )


def build_date_filters(start_date, end_date):
    conditions = []
    params = []

    if start_date:
        conditions.append("start_time >= %s")
        params.append(
            datetime.combine(start_date, time.min, tzinfo=timezone.utc)
        )

    if end_date:
        conditions.append("start_time < %s")
        params.append(
            datetime.combine(
                end_date + timedelta(days=1),
                time.min,
                tzinfo=timezone.utc,
            )
        )

    return conditions, params


@router.get("")
def list_cdr(
    page: int = Query(1, ge=1, le=1000000),
    page_size: int = Query(25, ge=1, le=100),
    start_date: date | None = None,
    end_date: date | None = None,
    src: str | None = Query(None, max_length=64),
    dst: str | None = Query(None, max_length=64),
    disposition: str | None = None,
    sort_by: str = Query("start_time"),
    sort_order: str = Query("desc"),
):
    if start_date and end_date and start_date > end_date:
        raise HTTPException(400, "start_date must not be after end_date")

    if sort_by not in SORT_COLUMNS:
        raise HTTPException(400, "Invalid sort field")

    if sort_order.lower() not in {"asc", "desc"}:
        raise HTTPException(400, "Invalid sort order")

    conditions, params = build_date_filters(start_date, end_date)

    if src and src.strip():
        conditions.append("src ILIKE %s")
        params.append(f"%{src.strip()}%")

    if dst and dst.strip():
        conditions.append("dst ILIKE %s")
        params.append(f"%{dst.strip()}%")

    if disposition:
        normalized = disposition.strip().upper()
        if normalized not in DISPOSITIONS:
            raise HTTPException(400, "Invalid disposition")
        conditions.append("disposition = %s")
        params.append(normalized)

    where_clause = (
        " WHERE " + " AND ".join(conditions) if conditions else ""
    )
    offset = (page - 1) * page_size

    try:
        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    f"SELECT COUNT(*) AS total FROM cdr_records{where_clause}",
                    params,
                )
                total = cursor.fetchone()["total"]

                cursor.execute(
                    f"""
                    SELECT id, src, dst, start_time, answer_time, end_time,
                           duration, billsec, disposition
                    FROM cdr_records
                    {where_clause}
                    ORDER BY {SORT_COLUMNS[sort_by]} {sort_order.upper()} NULLS LAST,
                             id DESC
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
        raise HTTPException(503, "Unable to retrieve call history")


@router.get("/summary")
def cdr_summary(
    start_date: date | None = None,
    end_date: date | None = None,
):
    if start_date and end_date and start_date > end_date:
        raise HTTPException(400, "start_date must not be after end_date")

    conditions, params = build_date_filters(start_date, end_date)
    where_clause = (
        " WHERE " + " AND ".join(conditions) if conditions else ""
    )

    try:
        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    f"""
                    SELECT
                        COUNT(*) AS total_calls,
                        COUNT(*) FILTER (
                            WHERE disposition = 'ANSWERED'
                        ) AS answered,
                        COUNT(*) FILTER (
                            WHERE disposition = 'NO ANSWER'
                        ) AS no_answer,
                        COUNT(*) FILTER (
                            WHERE disposition = 'BUSY'
                        ) AS busy,
                        COUNT(*) FILTER (
                            WHERE disposition IN ('FAILED', 'CONGESTION')
                        ) AS failed,
                        COALESCE(SUM(duration), 0) AS total_duration,
                        COALESCE(SUM(billsec), 0) AS total_billsec,
                        COALESCE(
                            ROUND(AVG(billsec) FILTER (
                                WHERE disposition = 'ANSWERED'
                            ), 2), 0
                        ) AS average_answered_billsec
                    FROM cdr_records
                    {where_clause}
                    """,
                    params,
                )
                return cursor.fetchone()
    except Exception:
        raise HTTPException(503, "Unable to retrieve CDR summary")


@router.get("/import-status")
def cdr_import_status():
    try:
        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT records_imported, last_import_at,
                           last_status, updated_at
                    FROM cdr_import_state
                    WHERE id = 1
                    """
                )
                state = cursor.fetchone()

                cursor.execute("SELECT COUNT(*) AS total FROM cdr_records")
                total = cursor.fetchone()["total"]

        return {
            "total_records": total,
            "records_imported": state["records_imported"] if state else 0,
            "last_import_at": state["last_import_at"] if state else None,
            "last_status": state["last_status"] if state else "not_started",
            "updated_at": state["updated_at"] if state else None,
        }
    except Exception:
        raise HTTPException(503, "Unable to retrieve import status")


@router.get("/{record_id}")
def get_cdr_record(record_id: int):
    if record_id < 1:
        raise HTTPException(400, "Invalid CDR record ID")

    try:
        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT id, src, dst, dcontext, channel, dstchannel,
                           lastapp, lastdata, start_time, answer_time,
                           end_time, duration, billsec, disposition, amaflags
                    FROM cdr_records
                    WHERE id = %s
                    """,
                    [record_id],
                )
                record = cursor.fetchone()

        if not record:
            raise HTTPException(404, "CDR record not found")

        return record
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(503, "Unable to retrieve CDR record")
