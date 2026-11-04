import os

import psycopg
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(
    title="PBX Management API",
    version="0.1.0",
    docs_url=None,
    redoc_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[],
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=[],
)


@app.get("/api/health")
def health():
    return {
        "application": "PBX Management API",
        "status": "ok",
        "version": "0.1.0",
    }


@app.get("/api/status")
def status():
    database_status = "connected"

    try:
        with psycopg.connect(
            host=os.environ["PGHOST"],
            dbname=os.environ["PGDATABASE"],
            user=os.environ["PGUSER"],
            password=os.environ["PGPASSWORD"],
            connect_timeout=3,
        ) as connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1")
                cursor.fetchone()
    except Exception:
        database_status = "unavailable"

    return {
        "application": "PBX Management",
        "api": "online",
        "database": database_status,
        "asterisk": "not_connected",
    }
