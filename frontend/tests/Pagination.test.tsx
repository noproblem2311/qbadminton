import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Pagination, pageItems } from '../src/components/Pagination';

describe('pageItems', () => {
  it.each([
    [1, 1, [1]],
    [1, 3, [1, 2, 3]],
    [5, 10, [1, 'gap', 4, 5, 6, 'gap', 10]],
    [3, 10, [1, 2, 3, 4, 'gap', 10]],
    [10, 10, [1, 'gap', 9, 10]],
  ])('page %i of %i → %j', (page, total, expected) => {
    expect(pageItems(page, total)).toEqual(expected);
  });
});

describe('Pagination', () => {
  it('renders nothing for a single page', () => {
    const { container } = render(<Pagination page={1} totalPages={1} onChange={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('marks the current page and navigates', () => {
    const onChange = vi.fn();
    render(<Pagination page={1} totalPages={4} onChange={onChange} />);

    expect(screen.getByRole('button', { name: '← Trước' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Trang 1' })).toHaveAttribute('aria-current', 'page');

    fireEvent.click(screen.getByRole('button', { name: 'Sau →' }));
    fireEvent.click(screen.getByRole('button', { name: 'Trang 4' }));
    expect(onChange.mock.calls).toEqual([[2], [4]]);
  });
});
