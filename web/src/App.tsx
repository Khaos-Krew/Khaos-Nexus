type ServiceState = 'online' | 'degraded' | 'stub';

type ServiceCard = {
  name: string;
  detail: string;
  state: ServiceState;
};

const services: ServiceCard[] = [
  {
    name: 'Nexus API',
    detail: 'Development contract only — no production credentials attached.',
    state: 'stub'
  },
  {
    name: 'Nexus Sentinel',
    detail: 'Reserved for read-only bot health once the API contract is connected.',
    state: 'stub'
  },
  {
    name: 'Game Services',
    detail: 'Reserved for backend-first module and game-server health summaries.',
    state: 'stub'
  },
  {
    name: 'Private Owner Access',
    detail: 'Capability-gated owner surface. Private implementation remains outside public docs.',
    state: 'stub'
  }
];

const stateLabels: Record<ServiceState, string> = {
  online: 'Online',
  degraded: 'Degraded',
  stub: 'Not connected'
};

export default function App() {
  const apiBase = import.meta.env.VITE_NEXUS_API_BASE_URL ?? 'stub://nexus-api/v1';

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
          <a className="nav-item locked" href="#private" aria-disabled="true">Private</a>
        </nav>

        <div className="sidebar-footer">
          <span className="environment-dot" />
          Incubation environment
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div>
            <p className="eyebrow">Khaos Nexus / Side Project</p>
            <h1>Control Center</h1>
          </div>
          <button type="button" className="account-button" disabled>
            Sign-in pending
          </button>
        </header>

        <section className="hero" id="dashboard">
          <div>
            <span className="status-pill">Read-only foundation</span>
            <h2>One lightweight interface for Nexus services.</h2>
            <p>
              This shell is intentionally disconnected from production. The next step is a safe,
              versioned API contract followed by Discord/Nexus authentication.
            </p>
          </div>
          <div className="hero-stat">
            <span>API target</span>
            <code>{apiBase}</code>
          </div>
        </section>

        <section className="section" id="services">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Foundation milestone</p>
              <h2>Service health</h2>
            </div>
            <span className="muted">Stub data only</span>
          </div>

          <div className="service-grid">
            {services.map((service) => (
              <article className="service-card" key={service.name}>
                <div className="service-card-header">
                  <h3>{service.name}</h3>
                  <span className={`service-state ${service.state}`}>
                    {stateLabels[service.state]}
                  </span>
                </div>
                <p>{service.detail}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="section compact" id="account">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Access model</p>
              <h2>Authentication boundary</h2>
            </div>
          </div>
          <div className="notice">
            No privileged control will be enabled until backend-enforced Nexus capability checks,
            session handling, and audit logging are in place.
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
