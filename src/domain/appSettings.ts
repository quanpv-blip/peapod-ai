// Cấu hình vận hành do quản trị viên chỉnh trên giao diện (trang Cài đặt). Logic thuần: kiểm tra và chuẩn hóa đầu vào.
import type { Market } from './package.ts';

export interface AppSettings {
  /** Nguồn RSS theo thị trường (mỗi dòng một URL https). */
  feeds: Record<Market, string[]>;
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
}

export const DEFAULT_SETTINGS: AppSettings = {
  feeds: {
    JP: ['https://xtech.nikkei.com/rss/index.rdf', 'https://rss.itmedia.co.jp/rss/2.0/itmedia_all.xml'],
    VN: ['https://vnexpress.net/rss/so-hoa.rss'],
  },
  genTime: { VN: '07:00', JP: '07:00' },
  defaultPostTime: { VN: '11:30', JP: '12:00' },
  dailyCapUsd: 2,
  monthlyCapUsd: 30,
  priceInPerM: 0.75,
  priceOutPerM: 3.75,
  bucPausePct: 80,
  campaignDomains: ['xtech.nikkei.com', 'itmedia.co.jp', 'vnexpress.net'],
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
    genTime: { JP: time('genTimeJP', 'Giờ sinh bài JP'), VN: time('genTimeVN', 'Giờ sinh bài VN') },
    defaultPostTime: { JP: time('postTimeJP', 'Giờ đăng mặc định JP'), VN: time('postTimeVN', 'Giờ đăng mặc định VN') },
    dailyCapUsd: num('dailyCapUsd', 0, 1000, 'Trần ngày (USD)'),
    monthlyCapUsd: num('monthlyCapUsd', 0, 10000, 'Trần tháng (USD)'),
    priceInPerM: num('priceInPerM', 0, 1000, 'Đơn giá vào'),
    priceOutPerM: num('priceOutPerM', 0, 1000, 'Đơn giá ra'),
    bucPausePct: num('bucPausePct', 1, 100, 'Ngưỡng BUC (%)'),
    campaignDomains: lines(form.campaignDomains).map((d) => d.toLowerCase()),
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
