// A silent WAV file (8 kHz, 8-bit mono PCM) for the fake lesson's audio: a
// real, decodable track with a known duration, made on the fly so no binary
// is committed.
const SAMPLE_RATE = 8000;
const HEADER_BYTES = 44;
/** Unsigned 8-bit PCM is silent at the midpoint. */
const SILENCE = 128;

export function silentWav(durationMs: number): Uint8Array<ArrayBuffer> {
  const samples = Math.round((durationMs / 1000) * SAMPLE_RATE);
  const bytes = new Uint8Array(HEADER_BYTES + samples);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, s: string) =>
    [...s].forEach((ch, i) => view.setUint8(offset + i, ch.charCodeAt(0)));
  ascii(0, "RIFF");
  view.setUint32(4, HEADER_BYTES - 8 + samples, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE, true); // byte rate: 1 byte per sample
  view.setUint16(32, 1, true); // block align
  view.setUint16(34, 8, true); // bits per sample
  ascii(36, "data");
  view.setUint32(40, samples, true);
  bytes.fill(SILENCE, HEADER_BYTES);
  return bytes;
}
