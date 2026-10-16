import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SessionList } from '../src/components/SessionList';
import { makeSession } from './fixtures';

describe('SessionList', () => {
  const now = Date.parse('2026-10-15T11:00:00Z'); // 2026-10-15 18:00 in Vietnam

  it('renders sessions chronologically, grouped under day headings', () => {
    const tomorrowMorning = makeSession({ now, hoursFromNow: 14, location: 'Sân Ba' }); // 08:00 on the 16th
    const tonight = makeSession({ now, hoursFromNow: 1, location: 'Sân Hai' });
    const rightNow = makeSession({ now, hoursFromNow: 0, location: 'Sân Một' });

    render(<SessionList sessions={[tomorrowMorning, tonight, rightNow]} now={now} today="2026-10-15" />);

    const locations = screen.getAllByRole('article').map((card) => card.getAttribute('aria-label')?.split(' tại ')[1]);
    expect(locations).toEqual(['Sân Một', 'Sân Hai', 'Sân Ba']);

    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings[0]).toContain('Hôm nay');
    expect(headings[0]).toContain('Thứ Năm, 15/10/2026');
    expect(headings[0]).toContain('2 kèo');
    expect(headings[1]).toContain('Ngày mai');
    expect(headings[1]).toContain('1 kèo');
  });
});
