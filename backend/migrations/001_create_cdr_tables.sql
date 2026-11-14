BEGIN;

CREATE TABLE IF NOT EXISTS cdr_records (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    record_hash CHAR(64) NOT NULL UNIQUE,

    accountcode TEXT,
    src TEXT,
    dst TEXT,
    dcontext TEXT,
    clid TEXT,

    channel TEXT,
    dstchannel TEXT,
    lastapp TEXT,
    lastdata TEXT,

    start_time TIMESTAMPTZ,
    answer_time TIMESTAMPTZ,
    end_time TIMESTAMPTZ,

    duration INTEGER NOT NULL DEFAULT 0,
    billsec INTEGER NOT NULL DEFAULT 0,

    disposition TEXT NOT NULL,
    amaflags TEXT,
    userfield TEXT,
    uniqueid TEXT,

    imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT cdr_duration_nonnegative CHECK (duration >= 0),
    CONSTRAINT cdr_billsec_nonnegative CHECK (billsec >= 0)
);

CREATE INDEX IF NOT EXISTS idx_cdr_start_time
    ON cdr_records (start_time DESC);

CREATE INDEX IF NOT EXISTS idx_cdr_src
    ON cdr_records (src);

CREATE INDEX IF NOT EXISTS idx_cdr_dst
    ON cdr_records (dst);

CREATE INDEX IF NOT EXISTS idx_cdr_disposition
    ON cdr_records (disposition);

CREATE INDEX IF NOT EXISTS idx_cdr_uniqueid
    ON cdr_records (uniqueid)
    WHERE uniqueid IS NOT NULL AND uniqueid <> '';

CREATE TABLE IF NOT EXISTS cdr_import_state (
    id SMALLINT PRIMARY KEY DEFAULT 1,

    source_path TEXT NOT NULL,
    source_device BIGINT,
    source_inode BIGINT,
    last_position BIGINT NOT NULL DEFAULT 0,

    records_imported BIGINT NOT NULL DEFAULT 0,
    last_import_at TIMESTAMPTZ,
    last_status TEXT NOT NULL DEFAULT 'pending',
    last_error TEXT,

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT cdr_import_state_singleton CHECK (id = 1),
    CONSTRAINT cdr_import_position_nonnegative CHECK (last_position >= 0)
);

COMMIT;
