'use client';

import { useState } from 'react';

export function ReferralCaptureForm({ code, referrerName }: { code: string; referrerName: string }) {
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setState('sending');
    setMessage('');
    const form = new FormData(formElement);
    try {
      const response = await fetch(`/api/referrals/${encodeURIComponent(code)}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(form.entries())),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'We could not save your information.');
      setState('done');
      setMessage('Thanks — your information is with the team now.');
      formElement.reset();
    } catch (error) {
      setState('error');
      setMessage(error instanceof Error ? error.message : 'We could not save your information.');
    }
  }

  if (state === 'done') return <p role="status" style={{ color: '#2e8f5a' }}>{message}</p>;

  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: 12, maxWidth: 440 }}>
      <p style={{ margin: 0, color: '#666' }}>Referred by {referrerName}</p>
      <label aria-hidden="true" style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, overflow: 'hidden' }}>
        Website<input name="website" tabIndex={-1} autoComplete="off" />
      </label>
      <label>Name<input name="name" required autoComplete="name" /></label>
      <label>Phone<input name="phone" required autoComplete="tel" /></label>
      <label>Email (optional)<input name="email" type="email" autoComplete="email" /></label>
      <label>What do you need help with?<input name="service" autoComplete="off" /></label>
      <label>City<input name="city" autoComplete="address-level2" /></label>
      <button type="submit" disabled={state === 'sending'}>{state === 'sending' ? 'Sending…' : 'Send my information'}</button>
      {state === 'error' && <p role="alert" style={{ color: '#b42318', margin: 0 }}>{message}</p>}
    </form>
  );
}

