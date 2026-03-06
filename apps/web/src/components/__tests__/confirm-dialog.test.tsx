import { afterEach, describe, expect, mock, test } from 'bun:test';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ConfirmDialog } from '../confirm-dialog';

afterEach(cleanup);

describe('ConfirmDialog', () => {
  const defaultProps = {
    open: true,
    onOpenChange: mock(() => {}),
    title: 'Delete Channel',
    description: 'Are you sure you want to delete this channel?',
    onConfirm: mock(() => {}),
  };

  test('renders title and description when open', () => {
    render(<ConfirmDialog {...defaultProps} />);
    expect(screen.getByText('Delete Channel')).toBeDefined();
    expect(screen.getByText('Are you sure you want to delete this channel?')).toBeDefined();
  });

  test('renders default confirm label "Delete"', () => {
    render(<ConfirmDialog {...defaultProps} />);
    expect(screen.getByText('Delete')).toBeDefined();
  });

  test('renders custom confirm label', () => {
    render(<ConfirmDialog {...defaultProps} confirmLabel="Remove" />);
    expect(screen.getByText('Remove')).toBeDefined();
  });

  test('renders Cancel button', () => {
    render(<ConfirmDialog {...defaultProps} />);
    expect(screen.getByText('Cancel')).toBeDefined();
  });

  test('calls onConfirm and closes dialog on confirm click', () => {
    const onConfirm = mock(() => {});
    const onOpenChange = mock(() => {});
    render(<ConfirmDialog {...defaultProps} onConfirm={onConfirm} onOpenChange={onOpenChange} />);
    fireEvent.click(screen.getByText('Delete'));
    expect(onConfirm).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  test('calls onOpenChange(false) on cancel click', () => {
    const onOpenChange = mock(() => {});
    render(<ConfirmDialog {...defaultProps} onOpenChange={onOpenChange} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  test('does not render content when closed', () => {
    render(<ConfirmDialog {...defaultProps} open={false} />);
    expect(screen.queryByText('Delete Channel')).toBeNull();
  });
});
