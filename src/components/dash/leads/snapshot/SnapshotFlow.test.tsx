import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SnapshotFlow } from './SnapshotFlow';

// The confirm step is the safety story. These tests walk a photo through the
// reader (mocked) and pin the two things that must never regress: the Send
// button stays dead until the consent box is ticked, and a duplicate cannot
// be switched on.

const opener = { agentName: 'Jeffery', businessName: 'J&C Asphalt', optOutLine: 'Txt STOP to opt out anytime.' };

const extractReply = {
  snapshot_id: 'snap-1',
  unreadable: null,
  candidates: [
    { name: 'Rynell Davis', phone: '801-577-5322', address: '4958 W 8620 S', service: 'driveway', notes: null,
      confidence: { name: 0.95, phone: 0.92, address: 0.9 }, withheld: [] },
    { name: 'Shawn Keller', phone: '801-309-8290', address: null, service: null, notes: null,
      confidence: { name: 0.9, phone: 0.9, address: 0 }, withheld: [] },
  ],
  duplicates: [{ index: 1, reason: 'in-pipeline', lead_id: 'lead-9' }],
};

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) } as Response);
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); });

async function readOnePhoto() {
  fetchMock.mockImplementationOnce(() => jsonResponse(extractReply));
  render(<SnapshotFlow sessionId="s1" opener={opener} />);
  const input = screen.getByTestId('snapshot-library-input') as HTMLInputElement;
  const file = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], 'note.jpg', { type: 'image/jpeg' });
  fireEvent.change(input, { target: { files: [file] } });
  fireEvent.click(screen.getByRole('button', { name: /Read the photo/ }));
  await waitFor(() => expect(screen.getByText(/Found 2 leads/)).toBeInTheDocument());
}

describe('SnapshotFlow', () => {
  it('starts on capture with nothing sent and the read button disabled', () => {
    render(<SnapshotFlow sessionId="s1" opener={opener} />);
    expect(screen.getByRole('button', { name: /Take a photo/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Read the photo/ })).toBeDisabled();
    expect(screen.getByText(/Nothing is sent yet/)).toBeInTheDocument();
  });

  it('keeps Send dead until the consent box is ticked', async () => {
    await readOnePhoto();
    const send = screen.getByRole('button', { name: /Send 1 text/ });
    expect(send).toBeDisabled();
    expect(screen.getByText('Confirm these people asked to be contacted.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: /These people asked us to contact them/ }));
    expect(send).toBeEnabled();
  });

  it('locks a duplicate out of sending and links to the existing lead', async () => {
    await readOnePhoto();
    const dupToggle = screen.getByRole('checkbox', { name: 'Include lead 2' });
    expect(dupToggle).toBeDisabled();
    expect(dupToggle).not.toBeChecked();
    expect(screen.getByText('Already in your pipeline.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open/ })).toHaveAttribute('href', '/dash/s1/pipeline?spotlight=lead-9');
    // Only the one sendable row counts.
    expect(screen.getByRole('button', { name: /Send 1 text/ })).toBeInTheDocument();
  });

  it('shows what will be texted, using the tenant opener', async () => {
    await readOnePhoto();
    expect(screen.getByText(/this is Jeffery with J&C Asphalt\. You left your info with us about driveway/)).toBeInTheDocument();
  });

  it('disables Send again when the phone is edited into something untextable', async () => {
    await readOnePhoto();
    fireEvent.click(screen.getByRole('checkbox', { name: /These people asked us to contact them/ }));
    const phone = screen.getByRole('textbox', { name: 'Phone for lead 1' });
    fireEvent.change(phone, { target: { value: '555-12' } });
    expect(screen.getByRole('button', { name: /Send/ })).toBeDisabled();
    expect(screen.getByText('Fix the phone number first.')).toBeInTheDocument();
  });

  it('posts consent:true and the edited rows, then shows outcomes', async () => {
    await readOnePhoto();
    fireEvent.change(screen.getByRole('textbox', { name: 'Name for lead 1' }), { target: { value: 'Rynell D.' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /These people asked us to contact them/ }));
    fetchMock.mockImplementationOnce(() => jsonResponse({
      snapshot_id: 'snap-1', hold: false, send_after: null,
      outcomes: [
        { index: 0, outcome: 'sent', message: 'Text sent.', lead_id: 'lead-1' },
        { index: 1, outcome: 'skipped', message: 'Left out.' },
      ],
    }));
    fireEvent.click(screen.getByRole('button', { name: /Send 1 text/ }));

    await waitFor(() => expect(screen.getByText('1 text sent.')).toBeInTheDocument());
    const [, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.consent).toBe(true);
    expect(body.rows[0]).toMatchObject({ index: 0, include: true, name: 'Rynell D.', phone: '801-577-5322' });
    expect(body.rows[1]).toMatchObject({ index: 1, include: false });
    expect(screen.getByRole('link', { name: /Open the conversation/ })).toHaveAttribute('href', '/dash/s1/pipeline?spotlight=lead-1');
  });

  it('surfaces a reader failure and returns to capture', async () => {
    fetchMock.mockImplementationOnce(() => jsonResponse({ error: 'The reader is unavailable right now.' }, 502));
    render(<SnapshotFlow sessionId="s1" opener={opener} />);
    const input = screen.getByTestId('snapshot-library-input') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['x'], 'a.jpg', { type: 'image/jpeg' })] } });
    fireEvent.click(screen.getByRole('button', { name: /Read the photo/ }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('The reader is unavailable right now.'));
    expect(screen.getByRole('button', { name: /Take a photo/ })).toBeInTheDocument();
  });
});
