import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Modal } from './Modal';
describe('accessible modal boundary', () => {
  it('focuses the first action, traps Tab, closes on Escape and restores focus', () => {
    const trigger = document.createElement('button'); document.body.append(trigger); trigger.focus();
    const close = vi.fn(); const { unmount } = render(<Modal title="Проверка" onClose={close}><button>Первый</button><button>Последний</button></Modal>);
    const dialog = screen.getByRole('dialog', { name: 'Проверка' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('button', { name: 'Закрыть: Проверка' })).toHaveFocus();
    screen.getByRole('button', { name: 'Последний' }).focus(); fireEvent.keyDown(document, { key: 'Tab' });
    expect(screen.getByRole('button', { name: 'Закрыть: Проверка' })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' }); expect(close).toHaveBeenCalledOnce();
    unmount(); expect(trigger).toHaveFocus(); trigger.remove();
  });
});
