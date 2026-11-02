// Đọc thông số tệp WAV PCM (đầu ra của Gemini TTS: 24 kHz, mono, 16-bit, docs/99 E-22) để biết thời lượng.

export interface WavInfo {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  dataBytes: number;
  durationSec: number;
}

export function parseWav(buf: Uint8Array): WavInfo {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tag = (o: number) => String.fromCharCode(...buf.subarray(o, o + 4));
  if (buf.byteLength < 44 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Không phải tệp WAV hợp lệ');

  let pos = 12;
  let fmt: { sampleRate: number; channels: number; bits: number } | undefined;
  while (pos + 8 <= buf.byteLength) {
    const id = tag(pos);
    const size = dv.getUint32(pos + 4, true);
    if (id === 'fmt ') {
      fmt = { channels: dv.getUint16(pos + 10, true), sampleRate: dv.getUint32(pos + 12, true), bits: dv.getUint16(pos + 22, true) };
    } else if (id === 'data') {
      if (!fmt) throw new Error('WAV thiếu khối fmt trước data');
      // Tiêu đề phát trực tiếp có thể ghi kích thước 0 hoặc 0xFFFFFFFF: dùng phần còn lại của tệp.
      const remaining = buf.byteLength - (pos + 8);
      const dataBytes = size === 0 || size === 0xffffffff || size > remaining ? remaining : size;
      const bytesPerSec = fmt.sampleRate * fmt.channels * (fmt.bits / 8);
      return { sampleRate: fmt.sampleRate, channels: fmt.channels, bitsPerSample: fmt.bits, dataBytes, durationSec: dataBytes / bytesPerSec };
    }
    pos += 8 + size + (size % 2);
  }
  throw new Error('WAV thiếu khối data');
}
