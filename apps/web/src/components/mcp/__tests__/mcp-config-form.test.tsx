import { afterEach, describe, expect, mock, test } from 'bun:test';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MCPConfigForm } from '../mcp-config-form';
import type { MCPFormState } from '../use-mcp-form';

afterEach(cleanup);

const defaultForm: MCPFormState = {
  name: '',
  transport: 'sse',
  enabled: true,
  url: '',
  command: '',
  args: '',
  env: '',
  cwd: '',
  headers: '',
};

function renderForm(overrides: Partial<Parameters<typeof MCPConfigForm>[0]> = {}) {
  const props = {
    open: true,
    onOpenChange: mock(() => {}),
    editing: false,
    form: defaultForm,
    isStdio: false,
    setField: mock(() => {}),
    onSubmit: mock(() => {}),
    onCancel: mock(() => {}),
    triggerLabel: 'Add Server',
    onTriggerClick: mock(() => {}),
    ...overrides,
  };
  return { ...render(<MCPConfigForm {...props} />), props };
}

describe('MCPConfigForm', () => {
  test('renders dialog title "New Server" when not editing', () => {
    renderForm();
    expect(screen.getByText('New Server')).toBeDefined();
  });

  test('renders dialog title "Edit Server" when editing', () => {
    renderForm({ editing: true });
    expect(screen.getByText('Edit Server')).toBeDefined();
  });

  test('renders server name input', () => {
    renderForm();
    expect(screen.getByLabelText('Server name')).toBeDefined();
  });

  test('renders SSE URL input when not stdio', () => {
    renderForm({ isStdio: false });
    expect(screen.getByLabelText('Server URL')).toBeDefined();
  });

  test('renders command input when stdio', () => {
    renderForm({ isStdio: true });
    expect(screen.getByLabelText('Command')).toBeDefined();
    expect(screen.getByLabelText('Arguments')).toBeDefined();
  });

  test('renders working directory for stdio transport', () => {
    renderForm({ isStdio: true });
    expect(screen.getByLabelText('Working directory (optional)')).toBeDefined();
  });

  test('renders headers input for non-stdio transport', () => {
    renderForm({ isStdio: false });
    expect(screen.getByLabelText('Headers')).toBeDefined();
  });

  test('renders env input for stdio transport', () => {
    renderForm({ isStdio: true });
    expect(screen.getByLabelText('Environment variables')).toBeDefined();
  });

  test('shows "Create" button when not editing', () => {
    renderForm({ editing: false });
    expect(screen.getByText('Create')).toBeDefined();
  });

  test('shows "Update" button when editing', () => {
    renderForm({ editing: true });
    expect(screen.getByText('Update')).toBeDefined();
  });

  test('calls onSubmit when submit button clicked', () => {
    const { props } = renderForm();
    fireEvent.click(screen.getByText('Create'));
    expect(props.onSubmit).toHaveBeenCalled();
  });

  test('calls onCancel when cancel button clicked', () => {
    const { props } = renderForm();
    fireEvent.click(screen.getByText('Cancel'));
    expect(props.onCancel).toHaveBeenCalled();
  });

  test('calls setField on name input change', () => {
    const setField = mock(() => {});
    renderForm({ setField });
    fireEvent.change(screen.getByLabelText('Server name'), { target: { value: 'my-server' } });
    expect(setField).toHaveBeenCalledWith('name', 'my-server');
  });

  test('populates form values from props', () => {
    const filledForm: MCPFormState = {
      ...defaultForm,
      name: 'My MCP',
      url: 'https://mcp.example.com',
    };
    renderForm({ form: filledForm });
    expect((screen.getByLabelText('Server name') as HTMLInputElement).value).toBe('My MCP');
    expect((screen.getByLabelText('Server URL') as HTMLInputElement).value).toBe(
      'https://mcp.example.com',
    );
  });

  test('does not render content when dialog is closed', () => {
    renderForm({ open: false });
    expect(screen.queryByText('New Server')).toBeNull();
  });

  test('renders trigger button with label', () => {
    renderForm({ open: false, triggerLabel: 'Add MCP' });
    expect(screen.getByText('Add MCP')).toBeDefined();
  });
});
