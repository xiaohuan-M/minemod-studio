/** Pure interpolation shared by the editor and contract tests. Units: degrees / model pixels. */
export function sampleClip(clip, time) {
  const result = {};
  for (const track of clip.tracks) {
    const frames = track.keyframes;
    if (!frames.length) continue;
    let before = frames[0],
      after = frames.at(-1);
    for (const frame of frames) {
      if (frame.time <= time) before = frame;
      if (frame.time >= time) {
        after = frame;
        break;
      }
    }
    const amount =
      before.time === after.time
        ? 0
        : Math.max(0, Math.min(1, (time - before.time) / (after.time - before.time)));
    result[track.bone ?? track.element] = Object.fromEntries(
      [
        ['rotation', [0, 0, 0]],
        ['translation', [0, 0, 0]],
        ['scale', [1, 1, 1]],
      ].map(([field, fallback]) => [
        field,
        (before[field] ?? fallback).map((v, i) => v + ((after[field] ?? fallback)[i] - v) * amount),
      ]),
    );
  }
  return result;
}
