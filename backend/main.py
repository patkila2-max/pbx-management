import os

import psycopg
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from asterisk_gateway import gateway_request, GatewayError
from cdr_api import router as cdr_router
from events_api import router as events_router

app = FastAPI(
    title="PBX Management API",
    version="0.2.0",
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
        "version": "0.2.0",
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

    asterisk_status = "available"

    try:
        gateway_request("status")
    except GatewayError:
        asterisk_status = "unavailable"

    return {
        "application": "PBX Management",
        "api": "online",
        "database": database_status,
        "asterisk": asterisk_status,
    }


def get_asterisk_data(operation: str):
    try:
        result = gateway_request(operation)
        return result["data"]
    except GatewayError:
        raise HTTPException(
            status_code=503,
            detail="Asterisk monitoring service unavailable",
        )


@app.get("/api/asterisk/status")
def asterisk_status():
    return get_asterisk_data("status")


@app.get("/api/asterisk/settings")
def asterisk_settings():
    return get_asterisk_data("settings")


@app.get("/api/asterisk/channels")
def asterisk_channels():
    return get_asterisk_data("channels")


@app.get("/api/asterisk/endpoints")
def asterisk_endpoints():
    return get_asterisk_data("endpoints")


@app.get("/api/asterisk/contacts")
def asterisk_contacts():
    return get_asterisk_data("contacts")


@app.get("/api/asterisk/call-quality")
def asterisk_call_quality():
    return get_asterisk_data("call_quality")


app.include_router(cdr_router)
app.include_router(events_router)
