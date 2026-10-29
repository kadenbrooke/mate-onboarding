import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PasswordInput } from './PasswordInput';

function field() {
  return document.querySelector('input[name="password"]') as HTMLInputElement;
}

describe('PasswordInput', () => {
  it('starts hidden with a Show password button that cannot submit', () => {
    render(<PasswordInput name="password" autoComplete="current-password" defaultValue="hunter22" />);
    expect(field()).toHaveAttribute('type', 'password');
    const button = screen.getByRole('button', { name: 'Show password' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveAttribute('aria-pressed', 'false');
  });

  it('flips between shown and hidden, keeping the value', () => {
    render(<PasswordInput name="password" autoComplete="current-password" defaultValue="hunter22" />);
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(field()).toHaveAttribute('type', 'text');
    expect(field()).toHaveValue('hunter22');
    const hide = screen.getByRole('button', { name: 'Hide password' });
    expect(hide).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(hide);
    expect(field()).toHaveAttribute('type', 'password');
    expect(field()).toHaveValue('hunter22');
  });

  it('keeps the password-manager hints on the input', () => {
    render(<PasswordInput name="password" autoComplete="new-password" />);
    expect(field()).toHaveAttribute('autocomplete', 'new-password');
    expect(field()).toHaveAttribute('name', 'password');
  });

  it('does not submit the form when the eye is clicked', () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <PasswordInput name="password" autoComplete="current-password" />
      </form>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('re-hides before the form submit handler runs', () => {
    let typeAtSubmit: string | null = null;
    const onSubmit = vi.fn((e: React.FormEvent) => {
      e.preventDefault();
      typeAtSubmit = field().getAttribute('type');
    });
    render(
      <form onSubmit={onSubmit}>
        <PasswordInput name="password" autoComplete="current-password" defaultValue="hunter22" />
        <button type="submit">sign in</button>
      </form>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(field()).toHaveAttribute('type', 'text');
    fireEvent.click(screen.getByRole('button', { name: 'sign in' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(typeAtSubmit).toBe('password');
    expect(field()).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: 'Show password' })).toBeInTheDocument();
  });
});
