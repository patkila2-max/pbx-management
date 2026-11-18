import React, { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

const REFRESH_INTERVAL = 10000;

async function fetchJSON(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`${url}: HTTP ${response.status}`);
  }
  return response.json();
}

function Metric({ label, value, detail, state }) {
  return (
    <article className="card">
      <div className="metric-heading">
        <span className="muted">{label}</span>
        {state && <span className={`indicator ${state}`} />}
      </div>
      <div className="value">{value}</div>
      {detail && <div className="metric-detail">{detail}</div>}
    </article>
  );
}

function CDRSection() {
  const [summary, setSummary] = useState(null);
  const [importStatus, setImportStatus] = useState(null);
  const [records, setRecords] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);

  const [filters, setFilters] = useState({
    start_date: "",
    end_date: "",
    src: "",
    dst: "",
    disposition: "",
  });

  const [appliedFilters, setAppliedFilters] = useState({
    start_date: "",
    end_date: "",
    src: "",
    dst: "",
    disposition: "",
  });

  const PAGE_SIZE = 25;

  const refreshCDR = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const params = new URLSearchParams({
        page: String(page),
        page_size: String(PAGE_SIZE),
        sort_by: "start_time",
        sort_order: "desc",
      });

      Object.entries(appliedFilters).forEach(([key, value]) => {
        if (value) params.set(key, value);
      });

      const [history, totals, status] = await Promise.all([
        fetchJSON(`/api/cdr?${params.toString()}`),
        fetchJSON("/api/cdr/summary"),
        fetchJSON("/api/cdr/import-status"),
      ]);

      setRecords(history.items ?? []);
      setPagination(history.pagination ?? null);
      setSummary(totals);
      setImportStatus(status);
    } catch (err) {
      setError(`Unable to load call history: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [page, appliedFilters]);

  useEffect(() => {
    refreshCDR();

    const refreshInterval = window.setInterval(() => {
      refreshCDR();
    }, 30000);

    return () => window.clearInterval(refreshInterval);
  }, [refreshCDR]);

  function applyFilters(event) {
    event.preventDefault();
    setPage(1);
    setAppliedFilters({ ...filters });
  }

  function clearFilters() {
    const empty = {
      start_date: "",
      end_date: "",
      src: "",
      dst: "",
      disposition: "",
    };

    setFilters(empty);
    setPage(1);
    setAppliedFilters(empty);
  }

  async function viewRecord(id) {
    setSelectedRecord(null);
    try {
      const record = await fetchJSON(`/api/cdr/${id}`);
      setSelectedRecord(record);
    } catch (err) {
      setError(`Unable to load call details: ${err.message}`);
    }
  }

  function formatDate(value) {
    if (!value) return "—";
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime())
      ? value
      : parsed.toLocaleString();
  }

  function formatDuration(value) {
    const seconds = Number(value || 0);
    const minutes = Math.floor(seconds / 60);
    return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
  }

  function dispositionClass(value) {
    return String(value || "").toLowerCase().replace(/\s+/g, "-");
  }

  return (
    <section className="section cdr-section">
      <div className="section-heading">
        <div>
          <div className="eyebrow">CALL ANALYTICS</div>
          <h2>Call Detail Records</h2>
          <p className="muted">Historical call activity and call statistics</p>
        </div>
        <button onClick={refreshCDR} disabled={loading}>
          {loading ? "Loading..." : "Refresh CDR"}
        </button>
      </div>

      {summary && (
        <div className="grid cdr-summary">
          <Metric label="Total calls" value={summary.total_calls} detail="Recorded calls" />
          <Metric label="Answered" value={summary.answered} detail="Successfully answered" state="online" />
          <Metric label="No answer" value={summary.no_answer} detail="Unanswered calls" />
          <Metric label="Busy" value={summary.busy} detail="Busy destinations" />
          <Metric label="Failed" value={summary.failed} detail="Failed or congested calls" />
        </div>
      )}

      <div className="panel cdr-import-panel">
        <div>
          <span className="muted">CDR import status</span>
          <strong className={`import-state ${importStatus?.last_status === "success" ? "success" : ""}`}>
            {importStatus?.last_status ?? "Unavailable"}
          </strong>
        </div>
        <div>
          <span className="muted">Records in database</span>
          <strong>{importStatus?.total_records ?? "—"}</strong>
        </div>
        <div>
          <span className="muted">Last import (UTC)</span>
          <strong>
            {importStatus?.last_import_at
              ? formatDate(importStatus.last_import_at)
              : "Not available"}
          </strong>
        </div>
      </div>

      <form className="panel cdr-filters" onSubmit={applyFilters}>
        <div className="cdr-filter-grid">
          <label>
            Start date
            <input
              type="date"
              value={filters.start_date}
              onChange={(event) => setFilters({ ...filters, start_date: event.target.value })}
            />
          </label>
          <label>
            End date
            <input
              type="date"
              value={filters.end_date}
              onChange={(event) => setFilters({ ...filters, end_date: event.target.value })}
            />
          </label>
          <label>
            Source
            <input
              type="text"
              maxLength="64"
              placeholder="Source extension"
              value={filters.src}
              onChange={(event) => setFilters({ ...filters, src: event.target.value })}
            />
          </label>
          <label>
            Destination
            <input
              type="text"
              maxLength="64"
              placeholder="Destination extension"
              value={filters.dst}
              onChange={(event) => setFilters({ ...filters, dst: event.target.value })}
            />
          </label>
          <label>
            Disposition
            <select
              value={filters.disposition}
              onChange={(event) => setFilters({ ...filters, disposition: event.target.value })}
            >
              <option value="">All dispositions</option>
              <option value="ANSWERED">Answered</option>
              <option value="NO ANSWER">No answer</option>
              <option value="BUSY">Busy</option>
              <option value="FAILED">Failed</option>
              <option value="CONGESTION">Congestion</option>
            </select>
          </label>
        </div>
        <div className="cdr-filter-actions">
          <button type="submit">Apply filters</button>
          <button type="button" className="secondary-button" onClick={clearFilters}>
            Clear filters
          </button>
        </div>
      </form>

      {error && <div className="notice">{error}</div>}

      <div className="panel table-panel">
        <div className="cdr-table-heading">
          <strong>Call history</strong>
          <span className="muted">
            {pagination ? `${pagination.total} matching record(s)` : "Loading records"}
          </span>
        </div>

        <div className="table-scroll">
          <table className="cdr-table">
            <thead>
              <tr>
                <th>Date / time</th>
                <th>Source</th>
                <th>Destination</th>
                <th>Duration</th>
                <th>Talk time</th>
                <th>Disposition</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <tr key={record.id}>
                  <td>{formatDate(record.start_time)}</td>
                  <td>{record.src || "—"}</td>
                  <td>{record.dst || "—"}</td>
                  <td>{formatDuration(record.duration)}</td>
                  <td>{formatDuration(record.billsec)}</td>
                  <td>
                    <span className={`cdr-badge ${dispositionClass(record.disposition)}`}>
                      {record.disposition}
                    </span>
                  </td>
                  <td>
                    <button className="small-button" onClick={() => viewRecord(record.id)}>
                      View
                    </button>
                  </td>
                </tr>
              ))}
              {!records.length && (
                <tr>
                  <td colSpan="7" className="cdr-empty">
                    {loading ? "Loading call records..." : "No call records found."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="cdr-pagination">
          <button
            className="secondary-button"
            disabled={loading || page <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            Previous
          </button>
          <span className="muted">
            Page {pagination?.page ?? page} of {pagination?.pages ?? 0}
          </span>
          <button
            className="secondary-button"
            disabled={loading || !pagination || page >= pagination.pages}
            onClick={() => setPage((current) => current + 1)}
          >
            Next
          </button>
        </div>
      </div>

      {selectedRecord && (
        <div className="panel cdr-detail">
          <div className="section-heading">
            <h2>Call details · Record #{selectedRecord.id}</h2>
            <button className="secondary-button" onClick={() => setSelectedRecord(null)}>
              Close
            </button>
          </div>
          <div className="cdr-detail-grid">
            {[
              ["Source", selectedRecord.src],
              ["Destination", selectedRecord.dst],
              ["Context", selectedRecord.dcontext],
              ["Channel", selectedRecord.channel],
              ["Destination channel", selectedRecord.dstchannel],
              ["Application", selectedRecord.lastapp],
              ["Application data", selectedRecord.lastdata],
              ["Start time", formatDate(selectedRecord.start_time)],
              ["Answer time", formatDate(selectedRecord.answer_time)],
              ["End time", formatDate(selectedRecord.end_time)],
              ["Duration", formatDuration(selectedRecord.duration)],
              ["Talk time", formatDuration(selectedRecord.billsec)],
              ["Disposition", selectedRecord.disposition],
              ["AMA flags", selectedRecord.amaflags],
            ].map(([label, value]) => (
              <div key={label}>
                <span className="muted">{label}</span>
                <strong>{value || "—"}</strong>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}



function SystemEventsSection() {
  const [summary, setSummary] = useState(null);
  const [events, setEvents] = useState([]);
  const [alarms, setAlarms] = useState([]);
  const [alarmHistory, setAlarmHistory] = useState([]);
  const [category, setCategory] = useState("");
  const [severity, setSeverity] = useState("");
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refreshEvents = useCallback(async () => {
    setIsRefreshing(true);

    try {
      const params = new URLSearchParams({
        page: "1",
        page_size: "25",
      });

    if (category) params.set("category", category);
    if (severity) params.set("severity", severity);

    const results = await Promise.allSettled([
      fetchJSON("/api/events/summary"),
      fetchJSON(`/api/events?${params.toString()}`),
      fetchJSON("/api/alarms?page=1&page_size=25"),
      fetchJSON("/api/alarms/history?page=1&page_size=25"),
    ]);

    const failures = [];

    if (results[0].status === "fulfilled") {
      setSummary(results[0].value);
    } else {
      failures.push("event summary");
    }

    if (results[1].status === "fulfilled") {
      setEvents(results[1].value.items ?? []);
    } else {
      failures.push("event history");
    }

    if (results[2].status === "fulfilled") {
      setAlarms(results[2].value.items ?? []);
    } else {
      failures.push("active alarms");
    }

    if (results[3].status === "fulfilled") {
      setAlarmHistory(results[3].value.items ?? []);
    } else {
      failures.push("alarm history");
    }

      if (failures.length) {
        setError(`Unable to load: ${failures.join(", ")}`);
      } else {
        setError("");
        setLastUpdated(new Date());
      }
    } catch (err) {
      setError(`Refresh failed: ${err.message}`);
    } finally {
      setIsRefreshing(false);
    }
  }, [category, severity]);

  useEffect(() => {
    refreshEvents();

    const timer = window.setInterval(
      refreshEvents,
      REFRESH_INTERVAL
    );

    return () => window.clearInterval(timer);
  }, [refreshEvents]);

  function formatDate(value) {
    if (!value) return "—";

    const date = new Date(value);

    return Number.isNaN(date.getTime())
      ? "—"
      : date.toLocaleString();
  }

  function severityClass(value) {
    return `event-severity ${value || "info"}`;
  }

  return (
    <section className="section events-section">
      <div className="section-heading">
        <div>
          <h2>System Events &amp; Alarms</h2>
          <p className="muted">
            Asterisk operational events and alarm monitoring
          </p>
        </div>

        <div className="events-refresh-controls">
          <button
            type="button"
            onClick={refreshEvents}
            disabled={isRefreshing}
          >
            {isRefreshing ? "Refreshing…" : "Refresh events"}
          </button>
          <span className="muted" aria-live="polite">
            {lastUpdated
              ? `Last successful refresh: ${formatDate(lastUpdated)}`
              : "Waiting for successful refresh"}
          </span>
        </div>
      </div>

      {error && <div className="notice">{error}</div>}

      <div className="grid events-summary">
        <Metric
          label="Total events"
          value={summary?.totals?.total_events ?? "—"}
          detail="Recorded system events"
        />
        <Metric
          label="Last 24 hours"
          value={summary?.totals?.events_last_24h ?? "—"}
          detail="Recently received events"
        />
        <Metric
          label="Warnings"
          value={summary?.totals?.warnings ?? "—"}
          detail="Warning severity"
        />
        <Metric
          label="Critical events"
          value={summary?.totals?.critical_events ?? "—"}
          detail="Critical severity"
          state={summary?.totals?.critical_events ? "offline" : "online"}
        />
        <Metric
          label="Active alarms"
          value={alarms.length}
          detail="Alarms on current page"
          state={alarms.some(a => a.severity === "critical") ? "offline" : "online"}
        />
      </div>

      <div className="panel events-panel">
        <div className="events-panel-heading">
          <div>
            <h3>Active alarms</h3>
            <p className="muted">
              Critical alarms are displayed first
            </p>
          </div>
          <span className="muted">
            {alarms.length} displayed
          </span>
        </div>

        {alarms.length ? (
          <div className="table-scroll">
            <table className="events-table">
              <thead>
                <tr>
                  <th>Severity</th>
                  <th>Event</th>
                  <th>Category</th>
                  <th>Details</th>
                  <th>Received</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {alarms.map(alarm => (
                  <tr key={alarm.event_key}>
                    <td>
                      <span className={severityClass(alarm.severity)}>
                        {alarm.severity}
                      </span>
                    </td>
                    <td>{alarm.summary}</td>
                    <td>{alarm.category}</td>
                    <td>{JSON.stringify(alarm.details)}</td>
                    <td>{formatDate(alarm.received_at)}</td>
                    <td>
                      <span className="event-status active">
                        Active
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="events-empty">
            No active alarms currently recorded.
          </div>
        )}
      </div>

      <div className="panel events-panel">
        <div className="events-panel-heading">
          <div>
            <h3>System event history</h3>
            <p className="muted">
              Latest recorded Asterisk events
            </p>
          </div>
          <span className="muted">
            {events.length} displayed
          </span>
        </div>

        <div className="events-filters">
          <label>
            Category
            <select
              value={category}
              onChange={e => setCategory(e.target.value)}
            >
              <option value="">All categories</option>
              <option value="system">System</option>
              <option value="sip">SIP</option>
              <option value="call">Call</option>
            </select>
          </label>

          <label>
            Severity
            <select
              value={severity}
              onChange={e => setSeverity(e.target.value)}
            >
              <option value="">All severities</option>
              <option value="info">Info</option>
              <option value="warning">Warning</option>
              <option value="critical">Critical</option>
            </select>
          </label>
        </div>

        {events.length ? (
          <div className="table-scroll">
            <table className="events-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Event</th>
                  <th>Category</th>
                  <th>Severity</th>
                  <th>Summary</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {events.map(event => (
                  <tr key={event.event_key}>
                    <td>{formatDate(event.received_at)}</td>
                    <td>{event.event_type}</td>
                    <td>{event.category}</td>
                    <td>
                      <span className={severityClass(event.severity)}>
                        {event.severity}
                      </span>
                    </td>
                    <td>{event.summary}</td>
                    <td>{JSON.stringify(event.details)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="events-empty">
            No events match the selected filters.
          </div>
        )}
      </div>

      <div className="panel events-panel">
        <div className="events-panel-heading">
          <div>
            <h3>Alarm history</h3>
            <p className="muted">
              Active and resolved alarm records
            </p>
          </div>
          <span className="muted">
            {alarmHistory.length} displayed
          </span>
        </div>

        {alarmHistory.length ? (
          <div className="table-scroll">
            <table className="events-table">
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Severity</th>
                  <th>Summary</th>
                  <th>Occurred</th>
                  <th>Status</th>
                  <th>Resolved</th>
                </tr>
              </thead>
              <tbody>
                {alarmHistory.map(alarm => (
                  <tr key={alarm.event_key}>
                    <td>{alarm.event_type}</td>
                    <td>
                      <span className={severityClass(alarm.severity)}>
                        {alarm.severity}
                      </span>
                    </td>
                    <td>{alarm.summary}</td>
                    <td>{formatDate(alarm.occurred_at)}</td>
                    <td>
                      <span className={`event-status ${alarm.alarm_status}`}>
                        {alarm.alarm_status}
                      </span>
                    </td>
                    <td>{formatDate(alarm.resolved_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="events-empty">
            No alarm history recorded.
          </div>
        )}
      </div>

      <p className="table-note">
        Last updated: {lastUpdated ? lastUpdated.toLocaleTimeString() : "Loading"}
        {" · "}Automatic refresh every 10 seconds.
        {" "}All alarm and event controls are read-only.
      </p>
    </section>
  );
}

function App() {
  const [data, setData] = useState({
    system: null,
    asterisk: null,
    settings: null,
    channels: null,
    endpoints: null,
    contacts: null,
    callQuality: null,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState(null);

  const refreshDashboard = useCallback(async () => {
    setLoading(true);

    const requests = [
      ["system", "/api/status"],
      ["asterisk", "/api/asterisk/status"],
      ["settings", "/api/asterisk/settings"],
      ["channels", "/api/asterisk/channels"],
      ["endpoints", "/api/asterisk/endpoints"],
      ["contacts", "/api/asterisk/contacts"],
      ["callQuality", "/api/asterisk/call-quality"],
    ];

    const results = await Promise.allSettled(
      requests.map(([, url]) => fetchJSON(url))
    );

    const updated = {};
    const failures = [];

    results.forEach((result, index) => {
      const key = requests[index][0];

      if (result.status === "fulfilled") {
        updated[key] = result.value;
      } else {
        failures.push(key);
      }
    });

    setData((previous) => ({ ...previous, ...updated }));
    setLastUpdated(new Date());

    if (failures.length) {
      setError(`Some monitoring data could not be loaded: ${failures.join(", ")}`);
    } else {
      setError("");
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    refreshDashboard();
    const timer = window.setInterval(refreshDashboard, REFRESH_INTERVAL);
    return () => window.clearInterval(timer);
  }, [refreshDashboard]);

  const systemOnline = data.system?.api === "online";
  const databaseOnline = data.system?.database === "connected";
  const asteriskOnline = data.system?.asterisk === "available";

  const endpoints = data.endpoints?.endpoints ?? [];
  const contacts = data.contacts?.contacts ?? [];
  const channels = data.channels?.channels ?? [];
  const activeCalls = data.asterisk?.current_calls ?? 0;
  const qualityChannels = data.callQuality?.channels ?? [];

  const contactsByEndpoint = Object.fromEntries(
    contacts.map((contact) => [contact.endpoint, contact])
  );

  const registeredCount = endpoints.filter(
    (endpoint) => contactsByEndpoint[endpoint.name]
  ).length;

  const noContactCount = Math.max(0, endpoints.length - registeredCount);

  function formatExpiration(value) {
    if (!value) return "Not available";

    const expirationDate = new Date(value * 1000);
    const remainingSeconds = Math.floor(value - Date.now() / 1000);

    if (remainingSeconds <= 0) return "Expired";

    const minutes = Math.floor(remainingSeconds / 60);
    const seconds = remainingSeconds % 60;

    const remaining =
      minutes >= 60
        ? `${Math.floor(minutes / 60)}h ${minutes % 60}m`
        : `${minutes}m ${seconds}s`;

    return `${remaining} · ${expirationDate.toLocaleTimeString()}`;
  }

  function formatTimestamp(value) {
    if (!value) return "Not available";
    return value;
  }

  function formatMilliseconds(value) {
    if (value === null || value === undefined || value === "") return "—";
    const number = Number(value);
    return Number.isFinite(number) ? `${(number * 1000).toFixed(2)} ms` : "—";
  }

  function formatMes(value) {
    if (value === null || value === undefined || value === "") return "—";
    const number = Number(value);
    return Number.isFinite(number) ? number.toFixed(1) : "—";
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">TELEPHONY OPERATIONS</div>
          <h1>PBX Management</h1>
          <p className="muted">
            Centralized monitoring for your Asterisk telephony infrastructure.
          </p>
        </div>
        <div className="header-status">
          <span className={`indicator ${asteriskOnline ? "online" : "offline"}`} />
          {asteriskOnline ? "PBX connected" : "PBX unavailable"}
        </div>
      </header>

      <section className="banner">
        <div>
          <div className="eyebrow">SYSTEM OVERVIEW</div>
          <h2>Infrastructure monitoring</h2>
          <p className="muted">
            Monitoring-only dashboard · Automatic refresh every 10 seconds
          </p>
          <p className="updated">
            Last updated: {lastUpdated ? lastUpdated.toLocaleTimeString() : "Loading"}
          </p>
        </div>
        <button onClick={refreshDashboard} disabled={loading}>
          {loading ? "Refreshing..." : "Refresh now"}
        </button>
      </section>

      {error && <div className="notice">{error}</div>}

      <section className="section">
        <div className="section-heading">
          <h2>Platform health</h2>
          <span className="muted">{loading ? "Updating..." : "Live monitoring"}</span>
        </div>

        <div className="grid">
          <Metric
            label="API backend"
            value={systemOnline ? "Online" : "Unavailable"}
            detail="FastAPI application"
            state={systemOnline ? "online" : "offline"}
          />
          <Metric
            label="PostgreSQL"
            value={databaseOnline ? "Connected" : "Unavailable"}
            detail="Application database"
            state={databaseOnline ? "online" : "offline"}
          />
          <Metric
            label="Asterisk PBX"
            value={asteriskOnline ? "Connected" : "Unavailable"}
            detail={data.asterisk?.asterisk_version ?? "Version unavailable"}
            state={asteriskOnline ? "online" : "offline"}
          />
          <Metric
            label="Active calls"
            value={data.asterisk?.current_calls ?? "—"}
            detail="Current Asterisk calls"
          />
        </div>
      </section>

      <section className="section">
        <div className="section-heading">
          <h2>SIP registration monitoring</h2>
          <span className="muted">
            {endpoints.length} configured endpoint(s)
          </span>
        </div>

        <div className="grid registration-summary">
          <Metric
            label="Contacts present"
            value={data.contacts ? registeredCount : "—"}
            detail="Endpoints with a current PJSIP contact"
            state="online"
          />
          <Metric
            label="No contact found"
            value={data.contacts ? noContactCount : "—"}
            detail="Configured endpoints without a current contact"
            state={noContactCount ? "offline" : "online"}
          />
          <Metric
            label="Total configured"
            value={data.endpoints ? endpoints.length : "—"}
            detail="PJSIP endpoints"
          />
        </div>

        <div className="panel table-panel">
          {endpoints.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Extension</th>
                    <th>Registration</th>
                    <th>Device state</th>
                    <th>Contact IP</th>
                    <th>Port</th>
                    <th>SIP client</th>
                    <th>Expiration</th>
                    <th>Active channels</th>
                  </tr>
                </thead>
                <tbody>
                  {endpoints.map((endpoint) => {
                    const contact = contactsByEndpoint[endpoint.name];

                    return (
                      <tr key={endpoint.name}>
                        <td className="extension-name">{endpoint.name}</td>
                        <td>
                          <span className={`registration-badge ${contact ? "present" : "missing"}`}>
                            {contact ? "Contact present" : "No contact"}
                          </span>
                        </td>
                        <td>
                          <span className="state-label">
                            {endpoint.device_state ?? "Unknown"}
                          </span>
                        </td>
                        <td>{contact?.ip_address ?? "—"}</td>
                        <td>{contact?.port ?? "—"}</td>
                        <td className="user-agent">
                          {contact?.user_agent ?? "—"}
                        </td>
                        <td className="expiration">
                          {contact
                            ? formatExpiration(contact.expiration_time)
                            : "—"}
                        </td>
                        <td>{endpoint.active_channels ?? 0}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">
              {data.endpoints
                ? "No endpoints returned by Asterisk."
                : "Endpoint data unavailable."}
            </p>
          )}

          <p className="table-note">
            Contact presence confirms that Asterisk has a PJSIP contact.
            NonQualified means qualification is not being performed; it does
            not establish reachability.
          </p>
          {!data.contacts && (
            <p className="table-note">
              SIP contact information is currently unavailable.
            </p>
          )}
        </div>
      </section>

      <section className="section">
        <div className="section-heading">
          <h2>Active channels</h2>
          <span className="muted">{channels.length} channel(s)</span>
        </div>

        <div className="panel table-panel">
          {channels.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Channel</th>
                    <th>Caller</th>
                    <th>Connected party</th>
                    <th>Destination</th>
                    <th>State</th>
                    <th>Duration</th>
                    <th>Application</th>
                  </tr>
                </thead>
                <tbody>
                  {channels.map((channel, index) => {
                    const formatParty = (value) => {
                      if (!value || value === "<unknown>") return "—";
                      const number = String(value);
                      return /^\d{2,6}$/.test(number)
                        ? number
                        : number.length > 4
                          ? `${"*".repeat(number.length - 4)}${number.slice(-4)}`
                          : number;
                    };

                    return (
                      <tr key={channel.channel ?? index}>
                        <td>{channel.channel ?? "—"}</td>
                        <td>{formatParty(channel.caller_id_num)}</td>
                        <td>{formatParty(channel.connected_line_num)}</td>
                        <td>{channel.destination || "—"}</td>
                        <td>{channel.channel_state ?? "—"}</td>
                        <td>{channel.duration ?? "—"}</td>
                        <td>{channel.application ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">
              {data.channels ? "No active channels." : "Channel data unavailable."}
            </p>
          )}
        </div>
      </section>


      <section className="section">
        <div className="section-heading">
          <div>
            <h2>Live call quality</h2>
            <p className="muted">
              Real-time RTCP statistics for active PJSIP channels
            </p>
          </div>
          <span className="muted">
            {data.callQuality
              ? `${data.callQuality.count ?? 0} active channel(s)`
              : "Quality data unavailable"}
          </span>
        </div>

        <div className="grid quality-summary">
          <Metric
            label="Active PJSIP channels"
            value={data.callQuality?.count ?? "—"}
            detail="Channels returned by Asterisk"
          />
          <Metric
            label="RTCP available"
            value={data.callQuality
              ? qualityChannels.filter((channel) => channel.available).length
              : "—"}
            detail="Channels with RTCP statistics"
          />
        </div>

        <div className="panel table-panel">
          {qualityChannels.length ? (
            <div className="table-scroll">
              <table className="quality-table">
                <thead>
                  <tr>
                    <th>Channel</th>
                    <th>State</th>
                    <th>RTCP</th>
                    <th>RX packets</th>
                    <th>Local lost</th>
                    <th>TX packets</th>
                    <th>Remote lost</th>
                    <th>RX jitter</th>
                    <th>TX jitter</th>
                    <th>RTT</th>
                    <th>RX MES</th>
                    <th>TX MES</th>
                  </tr>
                </thead>
                <tbody>
                  {qualityChannels.map((channel) => {
                    const rtcp = channel.rtcp ?? {};
                    return (
                      <tr key={channel.channel}>
                        <td className="extension-name">{channel.channel}</td>
                        <td>{channel.channel_state ?? "—"}</td>
                        <td>
                          <span className={`registration-badge ${channel.available ? "present" : "missing"}`}>
                            {channel.available ? "Available" : "Unavailable"}
                          </span>
                        </td>
                        <td>{rtcp.receive_packets ?? "—"}</td>
                        <td>{rtcp.local_lost_packets ?? "—"}</td>
                        <td>{rtcp.transmit_packets ?? "—"}</td>
                        <td>{rtcp.remote_lost_packets ?? "—"}</td>
                        <td>{channel.available ? formatMilliseconds(rtcp.receive_jitter) : "—"}</td>
                        <td>{channel.available ? formatMilliseconds(rtcp.transmit_jitter) : "—"}</td>
                        <td>{channel.available ? formatMilliseconds(rtcp.round_trip_time) : "—"}</td>
                        <td>{channel.available ? formatMes(rtcp.receive_mes) : "—"}</td>
                        <td>{channel.available ? formatMes(rtcp.transmit_mes) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">
              {data.callQuality
                ? "No active PJSIP calls. Make a test call to view live RTCP statistics."
                : "Call quality data is currently unavailable."}
            </p>
          )}
          <p className="table-note">
            Jitter and round-trip time are displayed in milliseconds.
            Local loss and remote-reported loss are separate RTCP counters.
            MES values are shown without applying unverified quality thresholds.
          </p>
        </div>
      </section>

      <SystemEventsSection />

      <CDRSection />

      <section className="section">
        <div className="section-heading">
          <h2>Asterisk information</h2>
        </div>

        <div className="grid">
          <Metric
            label="Asterisk version"
            value={data.settings?.asterisk_version ?? "—"}
          />
          <Metric
            label="AMI version"
            value={data.settings?.ami_version ?? "—"}
          />
          <Metric
            label="CDR"
            value={data.settings?.cdr_enabled ?? "—"}
            detail="Call detail records"
          />
          <Metric
            label="HTTP service"
            value={data.settings?.http_enabled ?? "—"}
          />
        </div>

        <div className="panel startup-panel">
          <div>
            <span className="muted">Asterisk startup date</span>
            <strong>{formatTimestamp(data.asterisk?.startup_date)}</strong>
          </div>
          <div>
            <span className="muted">Asterisk startup time</span>
            <strong>{formatTimestamp(data.asterisk?.startup_time)}</strong>
          </div>
          <div>
            <span className="muted">Realtime configuration</span>
            <strong>{data.settings?.realtime_enabled ?? "—"}</strong>
          </div>
        </div>
      </section>

      <footer>
        PBX Management · Phase 4 · Secure monitoring interface
        <span>Call control and configuration changes are not exposed.</span>
      </footer>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
