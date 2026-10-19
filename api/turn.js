// Vercel serverless function: gives each visitor short-lived relay (TURN) credentials,
// so your real Metered secret never appears in the website code.
// Set these in Vercel > Project > Settings > Environment Variables:
//   METERED_APP     your Metered app name, e.g. home-studio  (from home-studio.metered.live)
//   METERED_SECRET  your Metered secret key
const hits = new Map(); // simple per-visitor limit (resets when the function restarts)
let cache = null;       // one credential is reused for an hour, so Metered's credential limit isn't hit

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const app = process.env.METERED_APP, secret = process.env.METERED_SECRET;
  if (!app || !secret) return res.status(500).json({ error: 'not configured' });

  const ip = (req.headers['x-forwarded-for'] || 'x').split(',')[0].trim();
  const now = Date.now(), recent = (hits.get(ip) || []).filter(t => now - t < 3600e3);
  if (recent.length >= 20) return res.status(429).json({ error: 'slow down' });
  hits.set(ip, [...recent, now]);
  if (cache && now - cache.at < 3600e3) return res.status(200).json(cache.ice);

  const fail = (step, status, body) => {
    // Metered's reason is shown here and in the Vercel logs (never the secret key)
    const message = (body && (body.message || body.error)) || null;
    console.error('metered', step, 'failed', status, JSON.stringify(body || {}).slice(0, 300));
    return res.status(502).json({ error: 'upstream', step, status, message });
  };

  try {
    const base = `https://${app}.metered.live/api/v1/turn`;
    const r1 = await fetch(`${base}/credential?secretKey=${encodeURIComponent(secret)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiryInSeconds: 6 * 3600, label: 'hs-' + now })
    });
    const c = await r1.json().catch(() => null);
    if (!r1.ok || !c || !c.apiKey) return fail('create', r1.status, c);

    const r2 = await fetch(`${base}/credentials?apiKey=${encodeURIComponent(c.apiKey)}`);
    const ice = await r2.json().catch(() => null);
    if (!r2.ok || !Array.isArray(ice) || !ice.length) return fail('get', r2.status, ice);

    cache = { at: now, ice };
    return res.status(200).json(ice);
  } catch (e) {
    return fail('network', 0, { message: String(e && e.message || e) });
  }
};
