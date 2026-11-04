import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ProductImage } from './ProductImage';

describe('product photo', () => {
  it('falls back for a missing or failed image and retries when its URL changes', () => {
    const { rerender } = render(<ProductImage name="Товар" />);
    expect(screen.getByLabelText('Фото недоступно')).toBeInTheDocument();
    rerender(<ProductImage name="Товар" url="https://basket-01.wbbasket.ru/1.webp" />);
    fireEvent.error(screen.getByRole('img', { name: 'Товар' }));
    expect(screen.queryByRole('img', { name: 'Товар' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Фото недоступно')).toBeInTheDocument();
    rerender(<ProductImage name="Товар" url="https://basket-02.wbbasket.ru/1.webp" />);
    expect(screen.getByRole('img', { name: 'Товар' })).toHaveAttribute('src', 'https://basket-02.wbbasket.ru/1.webp');
  });
});
