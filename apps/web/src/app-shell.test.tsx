import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { ThemeProvider } from '@/lib/theme';
import { routes } from '@/router';

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>,
  );
  return router;
}

describe('app shell', () => {
  it('renders the overview at /', () => {
    renderAt('/');
    expect(screen.getByRole('heading', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
  });

  it('navigates between sections via the sidebar', async () => {
    renderAt('/');
    const nav = screen.getByRole('navigation', { name: 'Main' });
    await userEvent.click(nav.querySelector('a[href="/sessions"]')!);
    expect(screen.getByRole('heading', { name: 'Sessions' })).toBeInTheDocument();
  });

  it('shows a 404 for unknown routes', () => {
    renderAt('/does-not-exist');
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });

  it('cycles the theme system → light → dark and persists it', async () => {
    renderAt('/');
    const toggle = screen.getByRole('button', { name: /Theme: system/ });
    await userEvent.click(toggle);
    expect(localStorage.getItem('fg-theme')).toBe('light');
    await userEvent.click(screen.getByRole('button', { name: /Theme: light/ }));
    expect(localStorage.getItem('fg-theme')).toBe('dark');
    expect(document.documentElement).toHaveClass('dark');
  });
});
