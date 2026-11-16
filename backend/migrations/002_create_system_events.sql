BEGIN;

CREATE TABLE IF NOT EXISTS pbx_system_events (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    event_key TEXT NOT NULL UNIQUE,
    event_type TEXT NOT NULL,
    category TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'info',

    source TEXT NOT NULL DEFAULT 'asterisk',
    summary TEXT NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,

    occurred_at TIMESTAMPTZ NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    is_alarm BOOLEAN NOT NULL DEFAULT FALSE,
    alarm_status TEXT,

    resolved_at TIMESTAMPTZ,

    CONSTRAINT pbx_event_severity_check
        CHECK (severity IN ('info', 'warning', 'critical')),

    CONSTRAINT pbx_event_alarm_status_check
        CHECK (
            alarm_status IS NULL
            OR alarm_status IN ('active', 'resolved')
        ),

    CONSTRAINT pbx_event_alarm_consistency_check
        CHECK (
            (is_alarm = FALSE AND alarm_status IS NULL)
            OR
            (is_alarm = TRUE AND alarm_status IS NOT NULL)
        )
);

CREATE INDEX IF NOT EXISTS idx_pbx_events_occurred
    ON pbx_system_events (occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_pbx_events_severity
    ON pbx_system_events (severity, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_pbx_events_active_alarms
    ON pbx_system_events (occurred_at DESC)
    WHERE is_alarm = TRUE AND alarm_status = 'active';

CREATE INDEX IF NOT EXISTS idx_pbx_events_category
    ON pbx_system_events (category, occurred_at DESC);

COMMIT;
