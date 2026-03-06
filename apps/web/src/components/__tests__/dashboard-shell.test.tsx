import { afterEach, describe, expect, mock, test } from 'bun:test';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

mock.module('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: mock(() => {}), replace: mock(() => {}) }),
}));

import { DashboardShell } from '../dashboard-shell';

afterEach(cleanup);

describe('DashboardShell', () => {
  test('renders sidebar content', () => {
    render(
      <DashboardShell sidebar={<div>Sidebar Content</div>}>
        <div>Main Content</div>
      </DashboardShell>,
    );
    expect(screen.getByText('Sidebar Content')).toBeDefined();
  });

  test('renders children content', () => {
    render(
      <DashboardShell sidebar={<div>Sidebar</div>}>
        <div>Main Content</div>
      </DashboardShell>,
    );
    expect(screen.getByText('Main Content')).toBeDefined();
  });

  test('renders mobile menu button', () => {
    render(
      <DashboardShell sidebar={<div>Sidebar</div>}>
        <div>Content</div>
      </DashboardShell>,
    );
    expect(screen.getByLabelText('Open sidebar')).toBeDefined();
  });

  test('renders brand name on mobile', () => {
    render(
      <DashboardShell sidebar={<div>Sidebar</div>}>
        <div>Content</div>
      </DashboardShell>,
    );
    expect(screen.getByText('PersonalClaw')).toBeDefined();
  });

  test('opens sidebar on menu button click and shows close button', () => {
    render(
      <DashboardShell sidebar={<div>Sidebar</div>}>
        <div>Content</div>
      </DashboardShell>,
    );
    fireEvent.click(screen.getByLabelText('Open sidebar'));
    expect(screen.getByLabelText('Close sidebar')).toBeDefined();
  });
});
