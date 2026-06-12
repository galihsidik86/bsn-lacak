import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Login } from './Login';

// Mock the auth module so tests don't hit network or touch real state.
const doLoginMock = vi.fn();
vi.mock('../lib/auth', () => ({
  doLogin: (...args: unknown[]) => doLoginMock(...args),
  useAuth: { getState: () => ({ setUser: vi.fn() }) },
}));

describe('<Login />', () => {
  beforeEach(() => { doLoginMock.mockReset(); });

  it('disables submit until both fields are filled', async () => {
    const user = userEvent.setup();
    render(<Login />);
    const btn = screen.getByRole('button', { name: /masuk/i });
    expect(btn).toBeDisabled();

    await user.type(screen.getByPlaceholderText(/supervisor/i), 'sup');
    expect(btn).toBeDisabled();

    await user.type(screen.getByPlaceholderText('••••••••'), 'Sekret123!ABC');
    expect(btn).toBeEnabled();
  });

  it('calls doLogin with trimmed username + raw password', async () => {
    const user = userEvent.setup();
    doLoginMock.mockResolvedValueOnce({ mustChangePassword: false });
    render(<Login />);
    await user.type(screen.getByPlaceholderText(/supervisor/i), '  supervisor  ');
    await user.type(screen.getByPlaceholderText('••••••••'), 'Sekret123!ABC');
    await user.click(screen.getByRole('button', { name: /masuk/i }));
    expect(doLoginMock).toHaveBeenCalledWith('supervisor', 'Sekret123!ABC');
  });

  it('shows the invalid-credentials message on 401', async () => {
    const user = userEvent.setup();
    doLoginMock.mockRejectedValueOnce({ response: { status: 401, data: { error: 'invalid_credentials' } } });
    render(<Login />);
    await user.type(screen.getByPlaceholderText(/supervisor/i), 'bad');
    await user.type(screen.getByPlaceholderText('••••••••'), 'BadPassWord1!');
    await user.click(screen.getByRole('button', { name: /masuk/i }));
    expect(await screen.findByText(/salah/i)).toBeInTheDocument();
  });

  it('shows the locked message on 423', async () => {
    const user = userEvent.setup();
    doLoginMock.mockRejectedValueOnce({ response: { status: 423 } });
    render(<Login />);
    await user.type(screen.getByPlaceholderText(/supervisor/i), 'sup');
    await user.type(screen.getByPlaceholderText('••••••••'), 'SekretSekret1!');
    await user.click(screen.getByRole('button', { name: /masuk/i }));
    expect(await screen.findByText(/terkunci/i)).toBeInTheDocument();
  });

  it('toggles password visibility', async () => {
    const user = userEvent.setup();
    render(<Login />);
    const pw = screen.getByPlaceholderText('••••••••') as HTMLInputElement;
    expect(pw.type).toBe('password');
    await user.click(screen.getByRole('button', { name: /tampilkan/i }));
    expect(pw.type).toBe('text');
  });
});
