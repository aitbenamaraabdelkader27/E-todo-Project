import { useState, type FormEvent } from 'react';
import { ArrowRight, ArrowUpRight, Check, Command, LoaderCircle, Sparkles } from 'lucide-react';
import { motion } from 'motion/react';
import type { Bootstrap } from '../../shared/types';
import { api } from '../api';

export function FlowLogo({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`flow-logo ${compact ? 'compact' : ''}`}>
      <span className="logo-mark">
        <span />
        <span />
        <span />
      </span>
      {!compact && (
        <span>
          E-Todo <strong>Flow</strong>
          <i />
        </span>
      )}
    </span>
  );
}

export function Welcome({ onSession }: { onSession: (data: Bootstrap) => void }) {
  const [mode, setMode] = useState<'welcome' | 'login' | 'register'>('welcome');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  async function demo() {
    setBusy(true);
    setError('');
    try {
      onSession(await api.demo(timezone));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to open demo.');
    } finally {
      setBusy(false);
    }
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const values = new FormData(e.currentTarget);
    try {
      onSession(
        mode === 'register'
          ? await api.register(
              String(values.get('name')),
              String(values.get('email')),
              String(values.get('password')),
              timezone,
            )
          : await api.login(String(values.get('email')), String(values.get('password'))),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="welcome">
      <header>
        <FlowLogo />
        <span className="welcome-topline">A little structure. A lot of possibility.</span>
        <span className="local-badge">
          <span /> Your day, thoughtfully arranged
        </span>
      </header>
      <div className="welcome-content">
        <motion.section
          className="welcome-copy"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <div className="eyebrow">
            <span className="tiny-line" /> MAKE ROOM FOR WHAT MATTERS
          </div>
          <h1>
            Your day.
            <br />A little more
            <br />
            <em>in flow.</em>
          </h1>
          <p>
            A clearer head starts with a clearer day. Bring your tasks, find your rhythm, and let
            the good work happen.
          </p>
          <div className="welcome-benefits">
            <span>
              <Check size={15} /> A timeline that makes sense
            </span>
            <span>
              <Check size={15} /> Thoughtful automatic planning
            </span>
            <span>
              <Check size={15} /> Space to change your mind
            </span>
          </div>
          <span className="welcome-signature">Plan your day, naturally.</span>
        </motion.section>
        <motion.section
          className="welcome-card"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.08 }}
        >
          <div className="welcome-card-icon">
            <Command size={25} />
          </div>
          <h2>
            {mode === 'welcome'
              ? 'Meet your calmer day.'
              : mode === 'register'
                ? 'A fresh start.'
                : 'Welcome back.'}
          </h2>
          <p>
            {mode === 'welcome'
              ? 'Less juggling. More doing. Step inside and make yourself at home.'
              : mode === 'register'
                ? 'Your ideas deserve a little breathing room.'
                : 'Pick up where you left off.'}
          </p>
          {mode === 'welcome' ? (
            <>
              <button className="primary-button demo-cta" onClick={demo} disabled={busy}>
                {busy ? <LoaderCircle className="spin" size={18} /> : <Sparkles size={18} />}{' '}
                {busy ? 'Preparing your day…' : 'Explore the live demo'}
                <ArrowRight size={17} />
              </button>
              <span className="demo-note">No account needed · Your own private workspace</span>
              <div className="or-divider">
                <span />
                or make it yours
                <span />
              </div>
              <button
                className="secondary-button full-width"
                onClick={() => {
                  setMode('register');
                  setError('');
                }}
              >
                Create an account
                <ArrowUpRight size={16} />
              </button>
              <p className="auth-switch">
                Already have an account?{' '}
                <button
                  onClick={() => {
                    setMode('login');
                    setError('');
                  }}
                >
                  Sign in
                </button>
              </p>
            </>
          ) : (
            <form onSubmit={submit} className="auth-form">
              {mode === 'register' && (
                <label>
                  <span>Your name</span>
                  <input
                    name="name"
                    autoComplete="name"
                    maxLength={80}
                    required
                    autoFocus
                    placeholder="Alex Morgan"
                  />
                </label>
              )}
              <label>
                <span>Email</span>
                <input
                  type="email"
                  name="email"
                  autoComplete="email"
                  maxLength={254}
                  required
                  autoFocus={mode === 'login'}
                  placeholder="you@example.com"
                />
              </label>
              <label>
                <span>Password</span>
                <input
                  type="password"
                  name="password"
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  minLength={mode === 'register' ? 10 : 1}
                  maxLength={72}
                  required
                  placeholder={mode === 'register' ? 'At least 10 characters' : 'Your password'}
                />
              </label>
              <button className="primary-button full-width" disabled={busy}>
                {busy ? 'One moment…' : mode === 'register' ? 'Create your workspace' : 'Sign in'}
                <ArrowRight size={16} />
              </button>
              <p className="auth-switch">
                {mode === 'register' ? 'Already a member?' : 'New here?'}{' '}
                <button
                  type="button"
                  onClick={() => {
                    setMode(mode === 'register' ? 'login' : 'register');
                    setError('');
                  }}
                >
                  {mode === 'register' ? 'Sign in' : 'Create an account'}
                </button>
              </p>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => {
                  setMode('welcome');
                  setError('');
                }}
              >
                ← Back to the demo
              </button>
            </form>
          )}
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          <div className="welcome-card-footer">
            <span className="soft-dot" /> A quiet place for a busy mind.
          </div>
        </motion.section>
      </div>
      <footer>
        <span>© {new Date().getFullYear()} E-Todo Flow</span>
        <span>Built for focus. Designed for life.</span>
        <span className="footer-key">Less noise. More flow.</span>
      </footer>
    </main>
  );
}
