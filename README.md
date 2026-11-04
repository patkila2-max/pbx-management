# PBX Management

Initial private management platform for an existing Asterisk installation.

## Services
- React frontend served by Nginx
- FastAPI backend
- PostgreSQL application database

## Initial status endpoints
- `/api/health`
- `/api/status`

The initial release does not connect to Asterisk AMI and does not modify Asterisk.
Configure `POSTGRES_PASSWORD` as a deployment environment variable before deploying.
Do not commit `.env` files or credentials to source control.
