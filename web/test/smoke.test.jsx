// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../src/App.jsx';

const routes = ['/', '/lighting', '/hvac', '/meter', '/energy', '/water', '/fire', '/security', '/lift', '/alarms', '/schedules', '/ai', '/controllers', '/reports', '/settings'];
describe('every route renders without throwing', () => {
  sessionStorage.setItem('anva.user', JSON.stringify({ name: 'Test', role: 'admin' }));
  it.each(routes)('%s', (r) => {
    const { container, unmount } = render(<MemoryRouter initialEntries={[r]}><App /></MemoryRouter>);
    expect(container.textContent.length).toBeGreaterThan(50);
    unmount();
  });
});
