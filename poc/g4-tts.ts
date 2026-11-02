// G-4 (phần TTS): tạo giọng đọc có timestamp theo ký tự và dựng phụ đề SRT.
// Chạy: npx tsx poc/g4-tts.ts --lang ja --text "本日はオフショア開発の品質管理についてご紹介いたします。"
import { buildCues, toSrt } from '../src/domain/subtitles.ts';
import { createXaiClient } from '../src/providers/xai.ts';
import { arg, loadEnv, saveEvidence } from './util.ts';

loadEnv();
const lang = arg('lang', 'ja') as 'ja' | 'vi';
const text = arg('text');
const voice = process.env[lang === 'ja' ? 'XAI_TTS_VOICE_JP' : 'XAI_TTS_VOICE_VN'] || undefined;

const res = await createXaiClient().ttsWithTimestamps({ text, language: lang, voiceId: voice });
const j = res.json as { audio: string; duration: number; audio_timestamps: { graph_chars: string[]; graph_times: [number, number][] } };
const audioPath = saveEvidence(`g4-tts-${lang}.mp3`, Buffer.from(j.audio, 'base64'));
const cues = buildCues(j.audio_timestamps.graph_chars, j.audio_timestamps.graph_times, { maxCharsPerLine: lang === 'ja' ? 18 : 42 });
const srtPath = saveEvidence(`g4-tts-${lang}.srt`, toSrt(cues));
console.log({ duration: j.duration, chars: text.length, cues: cues.length, audioPath, srtPath });
