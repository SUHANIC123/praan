/** Tried in order — AI Studio keys use the same Generative Language API. */
const GEMINI_MODELS = [
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent',
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent',
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-8b:generateContent',
  'https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent'
];

/**
 * @param {string} prompt
 * @param {{ maxOutputTokens?: number }} [opts]
 */
async function callGemini(prompt, opts) {
  const maxTok = opts?.maxOutputTokens ?? 512;
  let lastError;
  for (const modelUrl of GEMINI_MODELS) {
    try {
      const url = `${modelUrl}?key=${process.env.GEMINI_API_KEY}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: maxTok }
        })
      });
      const data = await res.json();
      if (res.status === 429 || res.status === 503) {
        lastError = new Error(`${modelUrl}: quota exceeded`);
        continue;
      }
      if (!res.ok) {
        lastError = new Error(`${modelUrl}: ${JSON.stringify(data.error?.message || data)}`);
        continue;
      }
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (!text) {
        const block = data.promptFeedback?.blockReason;
        const finish = data.candidates?.[0]?.finishReason;
        lastError = new Error(
          block ? `Gemini blocked prompt: ${block}` : finish ? `Gemini no text (finish: ${finish})` : 'Empty Gemini response'
        );
        continue;
      }
      return text;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError || new Error('All Gemini models failed');
}

module.exports = { callGemini };
