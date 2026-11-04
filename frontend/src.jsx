import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

function App() {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState("");

  async function refreshStatus() {
    try {
      const response = await fetch("/api/status", { cache: "no-store" });
      if (!response.ok) throw new Error("API returned an error");
      setStatus(await response.json());
      setError("");
    } catch {
      setError("Unable to reach the application API.");
    }
  }

  useEffect(() => {
    refreshStatus();
  }, []);

  const items = [
    ["Web application", status ? "Online" : error ? "Unavailable" : "Checking"],
    ["API backend", status?.api === "online" ? "Online" : "Checking"],
    ["PostgreSQL", status?.database ?? "Checking"],
    ["Asterisk PBX", "Not connected yet"],
  ];

  return (
    <main className="shell">
      <header>
        <div className="eyebrow">TELEPHONY OPERATIONS</div>
        <h1>PBX Management</h1>
        <p className="muted">
          Your private platform for monitoring and managing your PBX.
        </p>
      </header>

      <section className="banner">
        <div>
          <div className="eyebrow">SYSTEM OVERVIEW</div>
          <h2>Infrastructure status</h2>
          <p className="muted">Initial application health checks</p>
        </div>
        <button onClick={refreshStatus}>Refresh</button>
      </section>

      {error && <p className="error">{error}</p>}

      <section className="grid">
        {items.map(([name, value]) => (
          <article className="card" key={name}>
            <div className="muted">{name}</div>
            <div className="value">{value}</div>
          </article>
        ))}
      </section>

      <section className="panel">
        <h2>Next integration</h2>
        <p className="muted">
          Asterisk monitoring will be enabled after the secure host-side
          integration gateway is designed and approved.
        </p>
      </section>

      <footer>PBX Management · Initial release 0.1.0</footer>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
