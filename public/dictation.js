'use strict';
/* Helpers for live dictation: where to cut speech into phrases, and where to insert the text. */
(function (root) {
  // Feed it the loudness of the microphone at regular steps. It answers 'cut' when a phrase has
  // ended (a pause after speech, or the phrase got too long) and 'drop' when a stretch of silence
  // should be thrown away unsent. The noise floor adapts, so a fan or a quiet room both work.
  function createSegmenter({ minSpeechMs = 350, pauseMs = 650, maxMs = 8000, idleMs = 15000, floorWindowMs = 1500 } = {}) {
    const recent = [];
    let elapsed = 0, speech = 0, silent = 0;
    return {
      feed(level, dtMs) {
        // The noise floor is the quietest moment of the last 1.5 s: speech has gaps, steady noise does not.
        // Capped, so speech that starts at once is still heard.
        recent.push(level);
        const keep = Math.max(1, Math.round(floorWindowMs / dtMs));
        while (recent.length > keep) recent.shift();
        // Until the window has filled, assume a fairly quiet start so a soft first phrase is not swallowed.
        // The cap keeps sustained loud speech from being mistaken for noise (threshold never above 0.075).
        const cap = recent.length >= keep ? 0.03 : 0.02;
        const voiced = level > Math.max(0.015, Math.min(cap, Math.min(...recent)) * 2.5);
        elapsed += dtMs;
        if (voiced) { speech += dtMs; silent = 0; } else silent += dtMs;
        if (speech >= minSpeechMs && (silent >= pauseMs || elapsed >= maxMs)) return 'cut';
        if (speech < minSpeechMs && elapsed >= idleMs) return 'drop';
        return null;
      },
      heard: () => speech >= minSpeechMs,
      reset() { elapsed = 0; speech = 0; silent = 0; }
    };
  }

  // Puts `spoken` into `value` at `at` (replacing up to `replaceEnd`), with a space where one is needed.
  function insertAt(value, at, spoken, replaceEnd = at) {
    const head = value.slice(0, at), tail = value.slice(replaceEnd);
    const before = head && !/\s$/.test(head) && !/^[,.;:!?)\]]/.test(spoken) ? ' ' : '';
    const after = tail && !/^[\s,.;:!?)\]]/.test(tail) && !/[\s(]$/.test(spoken) ? ' ' : '';
    return { value: head + before + spoken + after + tail, pos: head.length + before.length + spoken.length };
  }

  const api = { createSegmenter, insertAt };
  if (typeof module !== 'undefined') module.exports = api; else root.GFDictation = api;
})(typeof window !== 'undefined' ? window : globalThis);
