// Vercel serverless function: gives each visitor short-lived relay (TURN) credentials,
// so your real Metered secret never appears in the website code.
// Set these in Vercel > Project > Settings > Environment Variables:
//   METERED_APP     your Metered app name, e.g. homestudio  (from homestudio.metered.live)
//   METERED_SECRET  your Metered secret key
// Check Metered's docs for "Create Credential" if their API has changed.
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

  try {
    const base = `https://${app}.metered.live/api/v1/turn`;
    const c = await fetch(`${base}/credential?secretKey=${encodeURIComponent(secret)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiryInSeconds: 6 * 3600, label: 'hs-' + now })
    }).then(r => r.json());
    if (!c.apiKey) throw new Error('no apiKey');
    const ice = await fetch(`${base}/credentials?apiKey=${encodeURIComponent(c.apiKey)}`).then(r => r.json());
    cache = { at: now, ice };
    return res.status(200).json(ice);
  } catch (e) {
    return res.status(502).json({ error: 'upstream' });
  }
};
