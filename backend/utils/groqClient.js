const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

/** Tried in order — see https://console.groq.com/docs/models */
const GROQ_MODELS = [
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
  'llama-3.1-70b-versatile'
];

/**
 * @param {string} prompt
 * @param {{ maxOutputTokens?: number }} [opts]
 */
async function callGroq(prompt, opts = {}) {
  const maxTokens = opts.maxOutputTokens ?? 1024;
  const key = (process.env.GROQ_API_KEY || '').trim();
  if (!key) throw new Error('GROQ_API_KEY is not set');

  let lastError;
  for (const model of GROQ_MODELS) {
    try {
      const res = await fetch(GROQ_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.2,
          max_tokens: maxTokens
        })
      });
      const data = await res.json();
      if (!res.ok) {
        const msg = data.error?.message || JSON.stringify(data);
        lastError = new Error(`${model}: ${msg}`);
        continue;
      }
      const text = data.choices?.[0]?.message?.content?.trim();
      if (!text) {
        lastError = new Error(`${model}: empty response`);
        continue;
      }
      return text;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError || new Error('All Groq models failed');
}

module.exports = { callGroq };
