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

function App() {
  const [data, setData] = useState({
    system: null,
    asterisk: null,
    settings: null,
    channels: null,
    endpoints: null,
    contacts: null,
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
                    <th>State</th>
                    <th>Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {channels.map((channel, index) => (
                    <tr key={channel.channel ?? index}>
                      <td>{channel.channel ?? "—"}</td>
                      <td>{channel.state ?? "—"}</td>
                      <td>{channel.duration ?? "—"}</td>
                    </tr>
                  ))}
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
