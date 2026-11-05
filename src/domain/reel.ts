// Trạng thái dựng video 9:16 và cách hiển thị tiến độ. Không phụ thuộc cơ sở dữ liệu nên dùng được ở cả giao diện và kiểm thử.

export type ReelState = 'pending' | 'ready' | 'error' | 'cancelled';
export type ReelStage = 'queued' | 'rendering' | 'finalizing';

export interface ReelStatus {
  state: ReelState;
  /** Lần cập nhật gần nhất (ISO). Việc đang dựng mà quá lâu không cập nhật coi như bị gián đoạn. */
  at: string;
  revision?: number;
  startedAt?: string;
  jobId?: string;
  stage?: ReelStage;
  /** Tiến độ 0..1. */
  progress?: number;
  frames?: number;
  totalFrames?: number;
  /** Số giây còn lại ước tính; null khi chưa đủ dữ liệu. */
  etaSeconds?: number | null;
  error?: string;
}

/** Không có cập nhật quá khoảng này thì coi như việc dựng đã bị gián đoạn (ví dụ máy chủ khởi động lại). */
export const REEL_STALE_MS = 3 * 60_000;

export function isReelStale(st: ReelStatus, now: Date): boolean {
  return st.state === 'pending' && now.getTime() - Date.parse(st.at) > REEL_STALE_MS;
}

export function reelPct(st: Pick<ReelStatus, 'progress'>): number {
  return Math.max(0, Math.min(100, Math.round((st.progress ?? 0) * 100)));
}

export function reelStageText(st: ReelStatus): string {
  switch (st.stage) {
    case 'queued':
      return 'Đang chờ đến lượt dựng';
    case 'finalizing':
      return 'Đang hoàn tất file MP4';
    case 'rendering':
      return st.totalFrames ? `Đang dựng khung hình ${st.frames ?? 0}/${st.totalFrames}` : 'Đang dựng khung hình';
    default:
      return 'Đang chuẩn bị';
  }
}

export function reelEtaText(st: ReelStatus): string {
  const s = st.etaSeconds;
  if (s === null || s === undefined) return 'đang tính thời gian còn lại';
  if (s <= 1) return 'sắp xong';
  if (s < 60) return `còn khoảng ${s} giây`;
  return `còn khoảng ${Math.floor(s / 60)} phút ${s % 60} giây`;
}

const JOB_ERRORS: Record<string, string> = {
  render_failed: 'Dịch vụ render gặp lỗi khi dựng. Thử dựng lại; nếu vẫn lỗi, xem nhật ký của máy render.',
};

/** Đổi mã lỗi kỹ thuật thành câu tiếng Việt. Câu đã sẵn nghĩa thì giữ nguyên. */
export function reelErrorText(code: string | undefined | null): string {
  if (!code) return 'Lỗi không xác định khi dựng video.';
  return JOB_ERRORS[code] ?? code.slice(0, 200);
}

/** Dữ liệu trả cho trang khi hỏi tiến độ. Không có trạng thái thì state = 'none'. */
export function reelView(st: ReelStatus | null, hasVideo: boolean) {
  if (!st) return { state: 'none' as const, pct: 0, stageText: '', etaText: '', error: null, hasVideo };
  return {
    state: st.state,
    pct: st.state === 'ready' ? 100 : reelPct(st),
    stageText: st.state === 'pending' ? reelStageText(st) : '',
    etaText: st.state === 'pending' ? reelEtaText(st) : '',
    error: st.state === 'error' ? st.error ?? 'Lỗi không xác định khi dựng video.' : null,
    hasVideo,
  };
}
