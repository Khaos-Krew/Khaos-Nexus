import { useEffect, useState } from 'react';
import {
  getHealthSnapshot,
  getReadinessSnapshot,
  getSessionSnapshot,
  nexusClientConfig
} from './api/client';
import type {
  HealthSnapshot,
  ReadinessSnapshot,
  ServiceState,
  SessionSnapshot
} from './api/contracts';
import { capabilities, hasCapability } from './auth/capabilities';

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

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

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches;
}

export default function App() {
  const [health, setHealth] = useState<HealthSnapshot | null>(null);
  const [session, setSession] = useState<SessionSnapshot | null>(null);
  const [readiness, setReadiness] = useState<ReadinessSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  const loadSnapshots = async () => {
    setLoading(true);
    try {
      const [nextHealth, nextSession, nextReadiness] = await Promise.all([
        getHealthSnapshot(),
        getSessionSnapshot(),
        getReadinessSnapshot()
      ]);
      setHealth(nextHealth);
      setSession(nextSession);
      setReadiness(nextReadiness);
      setLoadError(null);
    } catch (error: unknown) {
      setLoadError(error instanceof Error ? error.message : 'Unable to load Nexus status.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSnapshots();
    setInstalled(isStandalone());

    const onInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', onInstallPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onInstallPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const services = health?.services ?? [];
  const signedIn = session?.authenticated === true && session.user !== null;
  const staffAllowed = hasCapability(session, capabilities.staffAccess);
  const privateAllowed = hasCapability(session, capabilities.privateAccess);

  const signIn = () => window.location.assign('/api/v1/auth/discord/start');

  const signOut = async () => {
    await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'include' });
    await loadSnapshots();
  };

  const installApp = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === 'accepted') setInstallPrompt(null);
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">KN</div>
          <div>
            <strong>Khaos Nexus</strong>
            <span>Web Control Panel</span>
          </div>
        </div>

        <div className="dev-ribbon">UNDER DEVELOPMENT</div>

        <nav aria-label="Primary navigation">
          <a className="nav-item active" href="#dashboard">Dashboard</a>
          <a className="nav-item" href="#services">Services</a>
          <a className="nav-item" href="#readiness">Setup</a>
          <a className={`nav-item ${staffAllowed ? '' : 'locked'}`.trim()} href={staffAllowed ? '#staff' : '#account'}>Staff</a>
          <a className="nav-item" href="#account">Account</a>
          <a className={`nav-item ${privateAllowed ? '' : 'locked'}`.trim()} href={privateAllowed ? '#private' : '#account'}>Private</a>
        </nav>

        <div className="sidebar-footer">
          <span className="environment-dot" />
          {nexusClientConfig.environment} / {nexusClientConfig.dataMode}
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div>
            <p className="eyebrow">Khaos Nexus / Development Preview</p>
            <h1>Control Center</h1>
          </div>
          <div className="account-actions">
            {!installed && installPrompt && (
              <button type="button" className="account-button install-button" onClick={() => void installApp()}>
                Install App
              </button>
            )}
            {installed && <span className="installed-badge">Installed</span>}
            {signedIn && session.user?.avatarUrl && <img className="account-avatar" src={session.user.avatarUrl} alt="" />}
            <button type="button" className="account-button primary" onClick={signedIn ? signOut : signIn}>
              {signedIn ? `Sign out ${session.user?.displayName ?? ''}` : 'Sign in with Discord'}
            </button>
          </div>
        </header>

        <section className="hero" id="dashboard">
          <div>
            <span className="status-pill">Under Development</span>
            <h2>The lightweight control surface for Khaos Nexus.</h2>
            <p>
              This preview is designed for staff account preparation and mobile testing while Sentinel,
              game services, and the wider Nexus backend continue to come online independently.
            </p>
          </div>
          <div className="hero-stat-stack">
            <div className="hero-stat">
              <span>API target</span>
              <code>{nexusClientConfig.apiBase}</code>
            </div>
            <div className="hero-stat">
              <span>Session</span>
              <strong>{signedIn ? 'Authenticated' : 'Guest'}</strong>
            </div>
            <div className="hero-stat">
              <span>Deployment setup</span>
              <strong>{readiness?.ready ? 'Ready' : `${readiness?.readyCount ?? 0}/${readiness?.totalCount ?? 5}`}</strong>
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
              <p className="eyebrow">Live foundation</p>
              <h2>Service health</h2>
            </div>
            <div className="section-actions">
              <span className="muted">{loading ? 'Loading…' : `Updated ${formatTimestamp(health?.generatedAt)}`}</span>
              <button className="text-button" type="button" onClick={() => void loadSnapshots()}>Refresh</button>
            </div>
          </div>

          <div className="service-grid" aria-busy={loading}>
            {loading && services.length === 0 ? (
              <article className="service-card placeholder-card">
                <h3>Loading Nexus services…</h3>
                <p>The panel is resolving the same-origin Nexus API.</p>
              </article>
            ) : services.map((service) => (
              <article className="service-card" key={service.id}>
                <div className="service-card-header">
                  <h3>{service.name}</h3>
                  <span className={`service-state ${service.state}`}>{stateLabels[service.state]}</span>
                </div>
                <p>{service.summary}</p>
                <div className="service-meta">
                  <span>Checked {formatTimestamp(service.checkedAt)}</span>
                  {service.version && <code>{service.version}</code>}
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="section" id="readiness">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Deployment diagnostics</p>
              <h2>Setup readiness</h2>
            </div>
            <span className={`session-state ${readiness?.ready ? 'authenticated' : 'guest'}`}>
              {readiness?.ready ? 'Ready for staff sign-in' : `${readiness?.readyCount ?? 0} of ${readiness?.totalCount ?? 5} configured`}
            </span>
          </div>
          <div className="readiness-list">
            {(readiness?.checks ?? []).map((check) => (
              <div className="readiness-row" key={check.id}>
                <span className={`readiness-dot ${check.ready ? 'ready' : 'missing'}`} />
                <div>
                  <strong>{check.label}</strong>
                  <span>{check.detail ?? (check.ready ? 'Configured' : 'Configuration required')}</span>
                </div>
                <span className={check.ready ? 'check-ready' : 'check-missing'}>{check.ready ? 'Ready' : 'Missing'}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="section" id="staff">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Staff workspace</p>
              <h2>Operations</h2>
            </div>
            <span className={`session-state ${staffAllowed ? 'authenticated' : 'guest'}`}>
              {staffAllowed ? 'Staff access active' : 'Staff sign-in required'}
            </span>
          </div>

          <div className="quick-grid">
            <article className="quick-card">
              <span className="quick-icon">👤</span>
              <h3>Account Setup</h3>
              <p>Prepare and verify Nexus staff identity through Discord.</p>
              <span className="quick-status">{staffAllowed ? 'Available' : 'Locked'}</span>
            </article>
            <article className="quick-card">
              <span className="quick-icon">🛡️</span>
              <h3>Sentinel</h3>
              <p>Live Sentinel controls will appear here as backend APIs are accepted.</p>
              <span className="quick-status">Integration pending</span>
            </article>
            <article className="quick-card">
              <span className="quick-icon">🎮</span>
              <h3>Game Services</h3>
              <p>Backend-first module and server summaries will be consolidated here.</p>
              <span className="quick-status">Integration pending</span>
            </article>
            <article className="quick-card">
              <span className="quick-icon">📋</span>
              <h3>Staff Hub</h3>
              <p>This panel remains explicitly marked Under Development until owner approval.</p>
              <span className="quick-status">Development preview</span>
            </article>
          </div>
        </section>

        <section className="section compact" id="account">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Access model</p>
              <h2>Account</h2>
            </div>
            <span className={`session-state ${signedIn ? 'authenticated' : 'guest'}`}>
              {signedIn ? 'Authenticated' : 'Guest session'}
            </span>
          </div>
          <div className="notice">
            <strong>{signedIn ? session.user?.displayName : 'Discord account required.'}</strong>
            <span>
              {signedIn
                ? `Roles: ${session.user?.roles.join(', ') || 'none'}. Privileged actions remain server-authorized and audited.`
                : 'Sign in with an approved Discord staff account. Access is denied to accounts that are not on the development allowlist.'}
            </span>
          </div>
        </section>

        <section className="section compact" id="private">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Private capability</p>
              <h2>Owner surface</h2>
            </div>
            <span className={`session-state ${privateAllowed ? 'authenticated' : 'guest'}`}>
              {privateAllowed ? 'Allowed' : 'Locked'}
            </span>
          </div>
          <div className="notice">
            <strong>{privateAllowed ? 'Private capability verified.' : 'Owner capability required.'}</strong>
            <span>
              Private functionality stays behind server-side capability checks. The public client contains no private service credentials or implementation secrets.
            </span>
          </div>
        </section>
      </main>

      <nav className="mobile-nav" aria-label="Mobile navigation">
        <a className="active" href="#dashboard">Home</a>
        <a href="#services">Services</a>
        <a href="#readiness">Setup</a>
        <a href="#account">Account</a>
      </nav>
    </div>
  );
}
