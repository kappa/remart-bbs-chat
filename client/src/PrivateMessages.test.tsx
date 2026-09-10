import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PrivateMessages, PRIVATE_TIMEOUT_MS, type PrivatePopup } from './PrivateMessages';

// receivedAt is a monotonic clock, so a wall-clock jump cannot keep a popup alive.
beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] }); });
afterEach(() => { vi.useRealTimers(); });

const msg = (id: number, handle: string, text: string, color = '#0ff'): PrivatePopup =>
  ({ id, from: id * 10, handle, color, text, receivedAt: performance.now() });

describe('PrivateMessages', () => {
  it('keeps an empty live region on the page so the first message is announced', () => {
    const { container } = render(<PrivateMessages messages={[]} onDismiss={() => {}} />);
    expect(container.querySelector('.private-stack')).toHaveAttribute('aria-live', 'polite');
    expect(container.querySelectorAll('.private-popup').length).toBe(0);
  });

  it('shows sender in color and text, oldest first, as buttons in one live region', () => {
    render(<PrivateMessages messages={[msg(1, 'Bob', 'lunch?'), msg(2, 'Carol', 'later', '#f0f')]} onDismiss={() => {}} />);
    const stack = document.querySelector('.private-stack');
    expect(stack).toHaveAttribute('aria-live', 'polite');
    expect(document.querySelector('[role="status"]')).toBeNull();
    const popups = screen.getAllByRole('button');
    expect(popups.every((p) => p.classList.contains('private-popup'))).toBe(true);
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
    const second = { ...msg(2, 'Carol', 'b'), receivedAt: performance.now() - 5000 };
    rerender(<PrivateMessages messages={[second]} onDismiss={onDismiss} />);
    vi.advanceTimersByTime(PRIVATE_TIMEOUT_MS - 5000);
    expect(onDismiss).toHaveBeenCalledWith(2);
  });
});
