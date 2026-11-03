// Cấu hình vận hành do quản trị viên chỉnh trên giao diện (trang Cài đặt). Logic thuần: kiểm tra và chuẩn hóa đầu vào.
import type { Market } from './package.ts';

export interface AppSettings {
  /** Nguồn RSS theo thị trường (mỗi dòng một URL https). */
  feeds: Record<Market, string[]>;
  /** Số bài sinh tự động mỗi lần chạy, theo thị trường (1–5). */
  genCount: Record<Market, number>;
  /** Giờ chạy sinh bài hằng ngày theo giờ địa phương (HH:MM). */
  genTime: Record<Market, string>;
  /** Giờ đăng mặc định khi duyệt (HH:MM địa phương). */
  defaultPostTime: Record<Market, string>;
  /** Trần chi phí AI theo ngày và tháng (USD). 0 = không giới hạn. */
  dailyCapUsd: number;
  monthlyCapUsd: number;
  /** Đơn giá mô hình (USD / 1 triệu token). Chỉ là số cấu hình; đối chiếu trang giá chính thức trước khi tin. */
  priceInPerM: number;
  priceOutPerM: number;
  /** Ngưỡng sử dụng lượt gọi Meta (%) để tạm dừng đăng. */
  bucPausePct: number;
  /** Tên miền được phép làm nguồn cho bài chiến dịch (không tự tải trang; người dùng dán nội dung). */
  campaignDomains: string[];
  /** Tự duyệt bài VN khi đạt điều kiện (xem domain/autoApprove.ts). Mặc định tắt. JP luôn duyệt tay. */
  autoApproveVN: boolean;
  /** Số bài tự duyệt tối đa mỗi ngày (theo ngày ICT). */
  autoApproveDailyMax: number;
  /** Giới hạn yêu cầu AI mỗi ngày cho MỖI mô hình (gói miễn phí của Gemini: 20). Đối chiếu AI Studio. */
  aiRequestLimit: number;
  /** Số dư credit Gemini nhập tay (USD). 0 = chưa nhập. Trừ dần theo chi phí ghi nhận từ ngày nhập. */
  aiCreditUsd: number;
  /** Ngày nhập số dư (YYYY-MM-DD, giờ ICT). Trống nếu chưa nhập. */
  aiCreditAsOf: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  feeds: {
    JP: ['https://xtech.nikkei.com/rss/index.rdf', 'https://rss.itmedia.co.jp/rss/2.0/itmedia_all.xml'],
    VN: ['https://vnexpress.net/rss/so-hoa.rss'],
  },
  genCount: { VN: 2, JP: 2 },
  genTime: { VN: '07:00', JP: '07:00' },
  defaultPostTime: { VN: '11:30', JP: '12:00' },
  dailyCapUsd: 2,
  monthlyCapUsd: 30,
  priceInPerM: 0.75,
  priceOutPerM: 3.75,
  bucPausePct: 80,
  campaignDomains: ['xtech.nikkei.com', 'itmedia.co.jp', 'vnexpress.net'],
  autoApproveVN: false,
  autoApproveDailyMax: 3,
  aiRequestLimit: 20,
  aiCreditUsd: 0,
  aiCreditAsOf: '',
};

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export type SettingsCheck = { ok: true; value: AppSettings } | { ok: false; errors: string[] };

function lines(v: unknown): string[] {
  return String(v ?? '')
    .split(/\r?\n|,/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Đọc form (chuỗi) thành cấu hình; mọi lỗi được gom lại để hiển thị một lần. */
export function parseSettings(form: Record<string, unknown>): SettingsCheck {
  const errors: string[] = [];
  const num = (k: string, min: number, max: number, label: string): number => {
    const n = Number(String(form[k] ?? '').replace(',', '.'));
    if (!Number.isFinite(n) || n < min || n > max) errors.push(`${label} phải nằm trong [${min}, ${max}]`);
    return n;
  };
  const time = (k: string, label: string): string => {
    const v = String(form[k] ?? '').trim();
    if (!HHMM.test(v)) errors.push(`${label} phải dạng HH:MM`);
    return v;
  };
  const feeds = (k: string, label: string): string[] => {
    const urls = lines(form[k]);
    if (urls.length === 0) errors.push(`${label}: cần ít nhất một nguồn`);
    for (const u of urls) {
      try {
        if (new URL(u).protocol !== 'https:') errors.push(`${label}: ${u} phải là https`);
      } catch {
        errors.push(`${label}: ${u} không phải URL`);
      }
    }
    return urls;
  };

  const value: AppSettings = {
    feeds: { JP: feeds('feedsJP', 'Nguồn RSS JP'), VN: feeds('feedsVN', 'Nguồn RSS VN') },
    genCount: { JP: num('genCountJP', 1, 5, 'Số bài sinh mỗi lần (JP)'), VN: num('genCountVN', 1, 5, 'Số bài sinh mỗi lần (VN)') },
    genTime: { JP: time('genTimeJP', 'Giờ sinh bài JP'), VN: time('genTimeVN', 'Giờ sinh bài VN') },
    defaultPostTime: { JP: time('postTimeJP', 'Giờ đăng mặc định JP'), VN: time('postTimeVN', 'Giờ đăng mặc định VN') },
    dailyCapUsd: num('dailyCapUsd', 0, 1000, 'Trần ngày (USD)'),
    monthlyCapUsd: num('monthlyCapUsd', 0, 10000, 'Trần tháng (USD)'),
    priceInPerM: num('priceInPerM', 0, 1000, 'Đơn giá vào'),
    priceOutPerM: num('priceOutPerM', 0, 1000, 'Đơn giá ra'),
    bucPausePct: num('bucPausePct', 1, 100, 'Ngưỡng BUC (%)'),
    campaignDomains: lines(form.campaignDomains).map((d) => d.toLowerCase()),
    autoApproveVN: form.autoApproveVN === 'on' || form.autoApproveVN === '1' || form.autoApproveVN === true,
    autoApproveDailyMax: num('autoApproveDailyMax', 0, 20, 'Số bài tự duyệt tối đa mỗi ngày'),
    aiRequestLimit: num('aiRequestLimit', 1, 100000, 'Giới hạn yêu cầu AI mỗi ngày'),
    aiCreditUsd: num('aiCreditUsd', 0, 1000000, 'Số dư credit (USD)'),
    aiCreditAsOf: /^\d{4}-\d{2}-\d{2}$/.test(String(form.aiCreditAsOf ?? '')) ? String(form.aiCreditAsOf) : '',
  };
  if (value.campaignDomains.length === 0) errors.push('Cần ít nhất một tên miền cho bài chiến dịch');
  if (errors.length) return { ok: false, errors };
  return { ok: true, value };
}

/** Điền lại form từ cấu hình hiện tại (dùng cho trang Cài đặt). */
export function settingsToForm(s: AppSettings): Record<string, string> {
  return {
    feedsJP: s.feeds.JP.join('\n'),
    feedsVN: s.feeds.VN.join('\n'),
    genCountJP: String(s.genCount.JP),
    genCountVN: String(s.genCount.VN),
    genTimeJP: s.genTime.JP,
    genTimeVN: s.genTime.VN,
    postTimeJP: s.defaultPostTime.JP,
    postTimeVN: s.defaultPostTime.VN,
    dailyCapUsd: String(s.dailyCapUsd),
    monthlyCapUsd: String(s.monthlyCapUsd),
    priceInPerM: String(s.priceInPerM),
    priceOutPerM: String(s.priceOutPerM),
    bucPausePct: String(s.bucPausePct),
    campaignDomains: s.campaignDomains.join('\n'),
    autoApproveVN: s.autoApproveVN ? 'on' : '',
    autoApproveDailyMax: String(s.autoApproveDailyMax),
    aiRequestLimit: String(s.aiRequestLimit),
    aiCreditUsd: String(s.aiCreditUsd),
    aiCreditAsOf: s.aiCreditAsOf,
  };
}

/** Miền nguồn hợp lệ cho chiến dịch: URL https, host trùng hoặc là con của một miền được phép. */
export function campaignSourceAllowed(url: string, domains: string[]): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    return domains.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}
