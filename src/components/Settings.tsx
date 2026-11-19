import { useState, type FormEvent } from 'react';
import { Globe2, SlidersHorizontal } from 'lucide-react';
import type { User } from '../../shared/types';
import { Dialog } from './Dialog';

export function Settings({
  user,
  onSave,
  onClose,
}: {
  user: User;
  onSave: (input: Pick<User, 'name' | 'timezone' | 'dayStart' | 'dayEnd'>) => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const timezones = [
    ...new Set(['UTC', user.timezone, ...Intl.supportedValuesOf('timeZone')]),
  ].sort();
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const values = new FormData(e.currentTarget);
    const dayStart = String(values.get('dayStart'));
    const dayEnd = String(values.get('dayEnd'));
    if (dayEnd <= dayStart) {
      setError('Your day must end after it starts.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onSave({
        name: String(values.get('name')),
        timezone: String(values.get('timezone')),
        dayStart,
        dayEnd,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save settings.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title="Make space for your day" onClose={onClose}>
      <form className="settings-form" onSubmit={submit}>
        <label>
          <span>Your name</span>
          <input name="name" required maxLength={80} defaultValue={user.name} />
        </label>
        <div className="settings-section">
          <Globe2 size={18} />
          <div>
            <h3>Your time zone</h3>
            <p>
              Your timeline follows this zone, wherever you are. Existing tasks keep their exact
              instant.
            </p>
          </div>
        </div>
        <label>
          <span>Time zone</span>
          <select name="timezone" defaultValue={user.timezone}>
            {timezones.map((zone) => (
              <option key={zone} value={zone}>
                {zone.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </label>
        <div className="settings-section">
          <SlidersHorizontal size={18} />
          <div>
            <h3>A rhythm that works for you</h3>
            <p>
              Flow places new tasks within these hours. Your existing plans always stay in place.
            </p>
          </div>
        </div>
        <div className="form-grid">
          <label>
            <span>Day starts</span>
            <input type="time" name="dayStart" required defaultValue={user.dayStart} />
          </label>
          <label>
            <span>Day ends</span>
            <input type="time" name="dayEnd" required defaultValue={user.dayEnd} />
          </label>
        </div>
        <p className="field-hint">
          One daily availability window. Overnight availability is not supported.
        </p>
        {user.isDemo && (
          <p className="demo-settings-note">
            This private demo expires after 24 hours. Changes are saved within your demo workspace.
          </p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-footer">
          <span className="field-hint">A little structure goes a long way.</span>
          <button className="primary-button" disabled={busy}>
            {busy ? 'Saving…' : 'Save preferences'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
