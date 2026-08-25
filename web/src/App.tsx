import { useEffect, useState } from 'react';
import { getHealthSnapshot, getSessionSnapshot, nexusClientConfig } from './api/client';
import type { HealthSnapshot, ServiceState, SessionSnapshot } from './api/contracts';
import { capabilities, hasCapability } from './auth/capabilities';

const stateLabels: Record<ServiceState, string> = {
  online: 'Online',
  degraded: 'Degraded',
  offline: 'Offline',
  unknown: 'Not connected'
};

function formatTimestamp(value?: string) {
  if (!value) return 'Not yet loaded';
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit'
  }).format(new Date(value));
}

export default function App() {
  const [health, setHealth] = useState<HealthSnapshot | null>(null);
  const [session, setSession] = useState<SessionSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();

    Promise.all([
      getHealthSnapshot(controller.signal),
      getSessionSnapshot(controller.signal)
    ])
      .then(([nextHealth, nextSession]) => {
        setHealth(nextHealth);
        setSession(nextSession);
        setLoadError(null);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setLoadError(error instanceof Error ? error.message : 'Unable to load Nexus status.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, []);

  const services = health?.services ?? [];
  const signedIn = session?.authenticated === true && session.user !== null;
  const privateAllowed = hasCapability(session, capabilities.privateAccess);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">KN</div>
          <div>
            <strong>Khaos Nexus</strong>
            <span>Web Sidecar</span>
          </div>
        </div>

        <nav aria-label="Primary navigation">
          <a className="nav-item active" href="#dashboard">Dashboard</a>
          <a className="nav-item" href="#services">Services</a>
          <a className="nav-item" href="#account">Account</a>
          <a
            className={`nav-item ${privateAllowed ? '' : 'locked'}`.trim()}
            href={privateAllowed ? '#private' : '#account'}
            aria-disabled={!privateAllowed}
          >
            Private
          </a>
        </nav>

        <div className="sidebar-footer">
          <span className="environment-dot" />
          {nexusClientConfig.environment} / {nexusClientConfig.dataMode}
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div>
            <p className="eyebrow">Khaos Nexus / Side Project</p>
            <h1>Control Center</h1>
          </div>
          <button type="button" className="account-button" disabled={!signedIn}>
            {signedIn ? session.user?.displayName : 'Sign-in pending'}
          </button>
        </header>

        <section className="hero" id="dashboard">
          <div>
            <span className="status-pill">API contract v1</span>
            <h2>One lightweight interface for Nexus services.</h2>
            <p>
              The dashboard now consumes a typed Nexus API boundary. Stub mode is safe by default;
              live mode can be enabled later without changing the UI contract or exposing service secrets.
            </p>
          </div>
          <div className="hero-stat-stack">
            <div className="hero-stat">
              <span>API target</span>
              <code>{nexusClientConfig.apiBase}</code>
            </div>
            <div className="hero-stat">
              <span>Data mode</span>
              <strong>{nexusClientConfig.dataMode}</strong>
            </div>
          </div>
        </section>

        {loadError && (
          <div className="error-notice" role="alert">
            <strong>Nexus status unavailable.</strong>
            <span>{loadError}</span>
          </div>
        )}

        <section className="section" id="services">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Foundation milestone</p>
              <h2>Service health</h2>
            </div>
            <span className="muted">
              {loading ? 'Loading…' : `Updated ${formatTimestamp(health?.generatedAt)}`}
            </span>
          </div>

          <div className="service-grid" aria-busy={loading}>
            {loading && services.length === 0 ? (
              <article className="service-card placeholder-card">
                <h3>Loading Nexus services…</h3>
                <p>The sidecar is resolving the configured data source.</p>
              </article>
            ) : (
              services.map((service) => (
                <article className="service-card" key={service.id}>
                  <div className="service-card-header">
                    <h3>{service.name}</h3>
                    <span className={`service-state ${service.state}`}>
                      {stateLabels[service.state]}
                    </span>
                  </div>
                  <p>{service.summary}</p>
                  <div className="service-meta">
                    <span>Checked {formatTimestamp(service.checkedAt)}</span>
                    {service.version && <code>{service.version}</code>}
                  </div>
                </article>
              ))
            )}
          </div>
        </section>

        <section className="section compact" id="account">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Access model</p>
              <h2>Authentication boundary</h2>
            </div>
            <span className={`session-state ${signedIn ? 'authenticated' : 'guest'}`}>
              {signedIn ? 'Authenticated' : 'Guest session'}
            </span>
          </div>
          <div className="notice">
            <strong>Server authority only.</strong>
            <span>
              The browser may render capability-aware UI, but every privileged Nexus action will still
              require backend authorization and audit logging. The current stub session grants no capabilities.
            </span>
          </div>
        </section>

        <section className="section compact" id="private">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Capability gate</p>
              <h2>Private surface</h2>
            </div>
            <span className={`session-state ${privateAllowed ? 'authenticated' : 'guest'}`}>
              {privateAllowed ? 'Allowed' : 'Locked'}
            </span>
          </div>
          <div className="notice">
            <strong>{privateAllowed ? 'Capability verified in session projection.' : 'No private capability.'}</strong>
            <span>
              The public client contains only this generic gate. The backend remains responsible for
              independently enforcing private access on every related endpoint.
            </span>
          </div>
        </section>
      </main>

      <nav className="mobile-nav" aria-label="Mobile navigation">
        <a className="active" href="#dashboard">Home</a>
        <a href="#services">Services</a>
        <a href="#account">Account</a>
      </nav>
    </div>
  );
}
