import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PrivateMessages, PRIVATE_TIMEOUT_MS, type PrivateMessage } from './PrivateMessages';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-09T12:00:00Z')); });
afterEach(() => { vi.useRealTimers(); });

const msg = (id: number, handle: string, text: string, color = '#0ff'): PrivateMessage =>
  ({ id, from: id * 10, handle, color, text, receivedAt: Date.now() });

describe('PrivateMessages', () => {
  it('renders nothing when empty', () => {
    const { container } = render(<PrivateMessages messages={[]} onDismiss={() => {}} />);
    expect(container.querySelector('.private-stack')).toBeNull();
  });

  it('shows sender in color and text, oldest first, in a polite live region', () => {
    render(<PrivateMessages messages={[msg(1, 'Bob', 'lunch?'), msg(2, 'Carol', 'later', '#f0f')]} onDismiss={() => {}} />);
    const stack = document.querySelector('.private-stack');
    expect(stack).toHaveAttribute('aria-live', 'polite');
    const popups = Array.from(document.querySelectorAll('.private-popup'));
    expect(popups.map((p) => p.querySelector('.private-from')?.textContent)).toEqual(['Bob', 'Carol']);
    expect(popups[0].querySelector('.private-from')).toHaveStyle({ color: '#0ff' });
    expect(popups[1].querySelector('.private-text')?.textContent).toBe('later');
  });

  it('click dismisses that message', () => {
    const onDismiss = vi.fn();
    render(<PrivateMessages messages={[msg(1, 'Bob', 'lunch?'), msg(2, 'Carol', 'later')]} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByText('later'));
    expect(onDismiss).toHaveBeenCalledWith(2);
  });

  it('the oldest message expires after the timeout, then the next', () => {
    const onDismiss = vi.fn();
    const { rerender } = render(<PrivateMessages messages={[msg(1, 'Bob', 'a')]} onDismiss={onDismiss} />);
    vi.advanceTimersByTime(PRIVATE_TIMEOUT_MS - 1);
    expect(onDismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onDismiss).toHaveBeenCalledWith(1);
    const second = { ...msg(2, 'Carol', 'b'), receivedAt: Date.now() - 5000 };
    rerender(<PrivateMessages messages={[second]} onDismiss={onDismiss} />);
    vi.advanceTimersByTime(PRIVATE_TIMEOUT_MS - 5000);
    expect(onDismiss).toHaveBeenCalledWith(2);
  });
});
