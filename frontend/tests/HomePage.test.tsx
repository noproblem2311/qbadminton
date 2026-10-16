import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { REFRESH_INTERVAL_MS } from '../src/hooks/useSessions';
import { HomePage } from '../src/pages/HomePage';
import { makeSession, sessionsResponse } from './fixtures';

describe('HomePage', () => {
  it('fetches and lists upcoming sessions', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sessionsResponse([makeSession({ location: 'Sân Tuyên Sơn' }), makeSession({ location: 'Sân Chi Lăng', hoursFromNow: 5 })]),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<HomePage />);

    expect(screen.getByRole('status', { name: 'Đang tải danh sách kèo' })).toBeInTheDocument();
    expect(await screen.findByText('Sân Tuyên Sơn')).toBeInTheDocument();
    expect(screen.getByText('Sân Chi Lăng')).toBeInTheDocument();
    expect(screen.getByText('2 kèo sắp diễn ra')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/sessions?limit=200', expect.anything());
  });

  it('shows the empty state when nothing is upcoming', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => sessionsResponse([])));
    render(<HomePage />);
    expect(await screen.findByText('Chưa có kèo nào sắp diễn ra')).toBeInTheDocument();
  });

  it('shows the error state and retries on demand', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockImplementation(async () => sessionsResponse([makeSession({ location: 'Sân sau khi thử lại' })]));
    vi.stubGlobal('fetch', fetchMock);

    render(<HomePage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Không tải được danh sách kèo');
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText('Sân sau khi thử lại')).toBeInTheDocument();
  });

  it('refreshes every 60 seconds and drops sessions that have started', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const startsSoon = makeSession({ location: 'Sân Ba Mươi Giây', hoursFromNow: 0.5 / 60 }); // in 30 s
    const later = makeSession({ location: 'Còn lâu', hoursFromNow: 3 });
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => sessionsResponse([startsSoon, later]))
      .mockImplementation(async () => sessionsResponse([later]));
    vi.stubGlobal('fetch', fetchMock);

    render(<HomePage />);
    expect(await screen.findByText('Sân Ba Mươi Giây')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS);
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText('Sân Ba Mươi Giây')).not.toBeInTheDocument());
    expect(screen.getByText('Còn lâu')).toBeInTheDocument();
  });

  it('hides a started session on the clock tick even before the next fetch', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const startsSoon = makeSession({ location: 'Sân Mười Giây', hoursFromNow: 10 / 3600 }); // in 10 s
    const fetchMock = vi.fn().mockImplementation(async () => sessionsResponse([startsSoon]));
    vi.stubGlobal('fetch', fetchMock);

    render(<HomePage />);
    expect(await screen.findByText('Sân Mười Giây')).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });

    expect(await screen.findByText('Chưa có kèo nào sắp diễn ra')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('passes filters to the API and mirrors them in the URL', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => sessionsResponse([]));
    vi.stubGlobal('fetch', fetchMock);

    render(<HomePage />);
    await screen.findByText('Chưa có kèo nào sắp diễn ra');

    fireEvent.change(screen.getByLabelText('Địa điểm'), { target: { value: 'Tuyên Sơn' } });

    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/sessions?location=Tuy%C3%AAn+S%C6%A1n&limit=200', expect.anything()),
    );
    expect(window.location.search).toBe('?location=Tuy%C3%AAn+S%C6%A1n');
    expect(await screen.findByText('Không có kèo nào khớp bộ lọc')).toBeInTheDocument();
  });

  it('filters by several of the six levels at once', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => sessionsResponse([]));
    vi.stubGlobal('fetch', fetchMock);

    render(<HomePage />);
    await screen.findByText('Chưa có kèo nào sắp diễn ra');
    const group = screen.getByRole('group', { name: 'Trình độ' });
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual(['Yếu', 'TBY', 'TB-', 'TB', 'TB+', 'Khá']);

    fireEvent.click(screen.getByRole('button', { name: 'Trung bình +' }));
    fireEvent.click(screen.getByRole('button', { name: 'Trung bình' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/sessions?level=TB%2CTB_PLUS&limit=200', expect.anything()),
    );
    expect(screen.getByRole('button', { name: 'Trung bình' })).toHaveAttribute('aria-pressed', 'true');
    expect(window.location.search).toBe('?level=TB%2CTB_PLUS');

    fireEvent.click(screen.getByRole('button', { name: 'Trung bình +' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/sessions?level=TB&limit=200', expect.anything()),
    );
  });

  it('filters by a start-time window and can clear it', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => sessionsResponse([]));
    vi.stubGlobal('fetch', fetchMock);

    render(<HomePage />);
    await screen.findByText('Chưa có kèo nào sắp diễn ra');

    fireEvent.change(screen.getByLabelText('Bắt đầu từ'), { target: { value: '18:00' } });
    fireEvent.change(screen.getByLabelText('Bắt đầu đến'), { target: { value: '20:30' } });

    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(
        '/api/v1/sessions?timeFrom=18%3A00&timeTo=20%3A30&limit=200',
        expect.anything(),
      ),
    );
    expect(window.location.search).toBe('?timeFrom=18%3A00&timeTo=20%3A30');

    fireEvent.click(screen.getByRole('button', { name: 'Bỏ chọn giờ' }));
    await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/sessions?limit=200', expect.anything()));
    expect(screen.getByLabelText('Bắt đầu từ')).toHaveValue('');
  });

  it('notes a window that crosses midnight', async () => {
    window.history.replaceState(null, '', '/?timeFrom=21:00&timeTo=01:00&timeTo=bogus');
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => sessionsResponse([])));

    render(<HomePage />);
    await screen.findByText('Không có kèo nào khớp bộ lọc');
    expect(screen.getByText('(qua nửa đêm)')).toBeInTheDocument();
  });

  it('restores level filters from the URL', async () => {
    window.history.replaceState(null, '', '/?level=KHA,YEU,BOGUS');
    const fetchMock = vi.fn().mockImplementation(async () => sessionsResponse([]));
    vi.stubGlobal('fetch', fetchMock);

    render(<HomePage />);
    await screen.findByText('Không có kèo nào khớp bộ lọc');
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/sessions?level=YEU%2CKHA&limit=200', expect.anything());
  });
});
