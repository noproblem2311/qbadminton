import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SessionCard } from '../src/components/SessionCard';
import { makeSession } from './fixtures';

describe('SessionCard', () => {
  const now = Date.parse('2026-10-15T11:00:00Z'); // 18:00 in Vietnam

  it('shows time, level, location, author, content and the Facebook link', () => {
    const session = makeSession({
      now,
      playDate: '2026-10-15',
      startTime: '19:00',
      endTime: '21:00',
      startsAt: '2026-10-15T12:00:00.000Z',
      level: 'Nữ Y+, Nam TB-',
      levels: [
        { code: 'YEU', name: 'Yếu' },
        { code: 'TB_MINUS', name: 'Trung bình -' },
      ],
      location: 'Sân Tuyên Sơn',
      author: 'Nguyễn Văn A',
      postUrl: 'https://www.facebook.com/groups/caulong/posts/123/',
    });

    render(<SessionCard session={session} now={now} />);

    expect(screen.getByText('19:00 – 21:00')).toBeInTheDocument();
    expect(screen.getByText('Bắt đầu sau 1 giờ')).toBeInTheDocument();
    const levels = screen.getByRole('list', { name: 'Trình độ' });
    expect(within(levels).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Yếu', 'TB-']);
    expect(levels).toHaveAttribute('title', 'Trình độ trong bài: Nữ Y+, Nam TB-');
    expect(screen.getByText('Sân Tuyên Sơn')).toBeInTheDocument();
    expect(screen.getByText('Nguyễn Văn A')).toBeInTheDocument();
    expect(screen.getByText(/thiếu 2 nam trình TB\+/u)).toBeInTheDocument();

    const link = screen.getByRole('link', { name: /Xem bài gốc trên Facebook/u });
    expect(link).toHaveAttribute('href', 'https://www.facebook.com/groups/caulong/posts/123/');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('labels unknown fields instead of leaving gaps and hides the link without a URL', () => {
    const session = makeSession({ now, location: null, author: null, level: null, levels: [], endTime: null, postUrl: null });
    render(<SessionCard session={session} now={now} />);

    expect(screen.getByText('Chưa rõ địa điểm')).toBeInTheDocument();
    expect(screen.getByText('Không rõ người đăng')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Trình độ' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('collapses long content behind "Xem thêm"', () => {
    const session = makeSession({ now, content: 'Dòng\n'.repeat(10) });
    render(<SessionCard session={session} now={now} />);

    fireEvent.click(screen.getByRole('button', { name: 'Xem thêm' }));
    expect(screen.getByRole('button', { name: 'Thu gọn' })).toBeInTheDocument();
  });
});
