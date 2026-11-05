// Việc "Tạo bản tin mới" chạy nền trong tiến trình API: người dùng bấm xong thấy ngay tiến độ thay vì chờ trang treo.
// Trạng thái giữ trong bộ nhớ (mất khi khởi động lại; bài đã tạo vẫn nằm trong hàng chờ). Mỗi thị trường chỉ một việc tại một thời điểm.
import { randomUUID } from 'node:crypto';
import type { Market } from '../domain/package.ts';
import type { GenerateResult } from './generate.ts';

export interface GenJob {
  id: string;
  market: Market;
  by: string;
  target: number;
  made: number;
  skipped: number;
  failed: number;
  state: 'running' | 'done' | 'error';
  message: string;
  startedAt: number;
  finishedAt: number | null;
  /** Lý do các mục bị bỏ qua hoặc lỗi (tối đa 5), để người dùng biết tại sao thiếu bài. */
  reasons: string[];
}

export interface GenJobView {
  id: string;
  market: Market;
  state: GenJob['state'];
  target: number;
  made: number;
  skipped: number;
  failed: number;
  pct: number;
  text: string;
  elapsedSec: number;
  reasons: string[];
}

const KEEP_MS = 10 * 60_000;
const MAX_RUN_MS = 10 * 60_000;

export class GenJobs {
  private jobs = new Map<string, GenJob>();

  constructor(private readonly now: () => number = Date.now) {}

  private prune(): void {
    const t = this.now();
    for (const [id, j] of this.jobs) if (j.finishedAt !== null && t - j.finishedAt > KEEP_MS) this.jobs.delete(id);
  }

  /** Việc đang chạy của thị trường (nếu có). Việc chạy quá lâu bị coi là hỏng để không chặn mãi. */
  running(market: Market): GenJob | null {
    for (const j of this.jobs.values()) {
      if (j.market === market && j.state === 'running') {
        if (this.now() - j.startedAt > MAX_RUN_MS) {
          j.state = 'error';
          j.message = 'Việc tạo bài chạy quá lâu nên đã bị dừng theo dõi.';
          j.finishedAt = this.now();
          continue;
        }
        return j;
      }
    }
    return null;
  }

  /**
   * Bắt đầu việc nền. Trả về null nếu thị trường này đang có việc chạy (chặn bấm chồng).
   * `run` nhận hàm báo tiến độ; lỗi bất ngờ được ghi vào việc, không làm sập tiến trình.
   */
  start(market: Market, by: string, target: number, run: (onProgress: (r: GenerateResult, made: number) => void) => Promise<GenerateResult[]>): GenJob | null {
    this.prune();
    if (this.running(market)) return null;
    const job: GenJob = { id: randomUUID(), market, by, target, made: 0, skipped: 0, failed: 0, state: 'running', message: '', startedAt: this.now(), finishedAt: null, reasons: [] };
    this.jobs.set(job.id, job);
    void run((r, made) => {
      job.made = made;
      if (r.outcome === 'skipped') job.skipped++;
      if (r.outcome === 'error') job.failed++;
      if ((r.outcome === 'skipped' || r.outcome === 'error') && job.reasons.length < 5) job.reasons.push(`${r.title ? `${r.title}: ` : ''}${r.detail}`);
    })
      .then((results) => {
        job.made = results.filter((r) => r.outcome === 'created').length;
        job.state = 'done';
        const paused = results.some((r) => r.detail === 'Công tắc tạm dừng đang bật');
        job.message = paused ? 'Công tắc tạm dừng đang bật: không sinh bài mới.' : '';
      })
      .catch((e: unknown) => {
        job.state = 'error';
        job.message = `Lỗi không mong đợi: ${(e as Error).message.slice(0, 160)}`;
      })
      .finally(() => {
        job.finishedAt = this.now();
      });
    return job;
  }

  /** Việc mới nhất của các thị trường được xem (đang chạy hoặc vừa xong trong 10 phút). */
  recent(markets: Market[]): GenJobView[] {
    this.prune();
    return [...this.jobs.values()]
      .filter((j) => markets.includes(j.market))
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, 3)
      .map((j) => this.view(j));
  }

  private view(j: GenJob): GenJobView {
    const end = j.finishedAt ?? this.now();
    const pct = j.state === 'done' ? 100 : Math.min(99, Math.round((j.made / Math.max(1, j.target)) * 100));
    const text =
      j.state === 'running'
        ? `Đang tạo bản tin ${j.market}: ${j.made}/${j.target} bài${j.skipped + j.failed ? `, ${j.skipped + j.failed} mục không đạt` : ''}`
        : j.state === 'error'
          ? j.message
          : j.message || `Đã tạo ${j.made}/${j.target} bản tin ${j.market}${j.skipped ? `, bỏ qua ${j.skipped} mục không đạt kiểm tra` : ''}${j.failed ? `, ${j.failed} lỗi gọi AI` : ''}.`;
    return { id: j.id, market: j.market, state: j.state, target: j.target, made: j.made, skipped: j.skipped, failed: j.failed, pct, text, elapsedSec: Math.round((end - j.startedAt) / 1000), reasons: j.reasons };
  }
}
