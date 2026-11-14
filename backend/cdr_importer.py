import csv
import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path

import psycopg


CDR_DIRECTORY = Path(os.getenv("CDR_DIRECTORY", "/var/lib/pbx-cdr"))

COLUMNS = [
    "accountcode", "src", "dst", "dcontext", "clid",
    "channel", "dstchannel", "lastapp", "lastdata",
    "start_time", "answer_time", "end_time",
    "duration", "billsec", "disposition", "amaflags",
    "userfield", "uniqueid",
]


def parse_timestamp(value):
    if not value:
        return None
    return datetime.strptime(
        value, "%Y-%m-%d %H:%M:%S"
    ).replace(tzinfo=timezone.utc)


def parse_integer(value):
    number = int(value or "0")
    if number < 0:
        raise ValueError("Negative duration")
    return number


def main():
    files = sorted(CDR_DIRECTORY.glob("*.csv"))

    if not files:
        raise SystemExit("No CSV files found in the CDR directory.")

    imported = 0
    duplicates = 0
    malformed = 0

    insert_sql = """
        INSERT INTO cdr_records (
            record_hash, accountcode, src, dst, dcontext, clid,
            channel, dstchannel, lastapp, lastdata,
            start_time, answer_time, end_time,
            duration, billsec, disposition, amaflags,
            userfield, uniqueid
        )
        VALUES (
            %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
            %s, %s, %s, %s, %s, %s, %s, %s, %s
        )
        ON CONFLICT (record_hash) DO NOTHING
    """

    with psycopg.connect(
        host=os.environ["PGHOST"],
        dbname=os.environ["PGDATABASE"],
        user=os.environ["PGUSER"],
        password=os.environ["PGPASSWORD"],
        connect_timeout=5,
    ) as connection:
        with connection.cursor() as cursor:
            cursor.execute("SELECT pg_advisory_xact_lock(741852963)")

            for file_path in files:
                with file_path.open(
                    newline="", encoding="utf-8"
                ) as csv_file:
                    reader = csv.reader(csv_file)

                    for row in reader:
                        try:
                            if len(row) != 18:
                                raise ValueError("Unexpected column count")

                            if not row[14].strip():
                                raise ValueError("Missing disposition")

                            record_hash = hashlib.sha256(
                                json.dumps(
                                    row,
                                    ensure_ascii=False,
                                    separators=(",", ":"),
                                ).encode("utf-8")
                            ).hexdigest()

                            values = [
                                record_hash,
                                *row[:9],
                                parse_timestamp(row[9]),
                                parse_timestamp(row[10]),
                                parse_timestamp(row[11]),
                                parse_integer(row[12]),
                                parse_integer(row[13]),
                                row[14],
                                row[15],
                                row[16],
                                row[17],
                            ]

                            cursor.execute(insert_sql, values)

                            if cursor.rowcount == 1:
                                imported += 1
                            else:
                                duplicates += 1

                        except (ValueError, TypeError, OverflowError):
                            malformed += 1

            status = "success" if malformed == 0 else "partial"

            cursor.execute(
                """
                INSERT INTO cdr_import_state (
                    id, source_path, records_imported,
                    last_import_at, last_status, last_error, updated_at
                )
                VALUES (1, %s, %s, NOW(), %s, %s, NOW())
                ON CONFLICT (id) DO UPDATE SET
                    source_path = EXCLUDED.source_path,
                    records_imported =
                        cdr_import_state.records_imported
                        + EXCLUDED.records_imported,
                    last_import_at = NOW(),
                    last_status = EXCLUDED.last_status,
                    last_error = EXCLUDED.last_error,
                    updated_at = NOW()
                """,
                (
                    str(CDR_DIRECTORY),
                    imported,
                    status,
                    f"{malformed} malformed row(s)" if malformed else None,
                ),
            )

    print("CDR import completed.")
    print(f"CSV files scanned: {len(files)}")
    print(f"New records imported: {imported}")
    print(f"Duplicates skipped: {duplicates}")
    print(f"Malformed rows skipped: {malformed}")


if __name__ == "__main__":
    main()
