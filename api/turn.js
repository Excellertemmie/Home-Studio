// Vercel serverless function: gives each visitor short-lived relay (TURN) credentials,
// so your real secret keys never appear in the website code.
//
// Option A (recommended): Cloudflare Realtime TURN. Set these in Vercel > Settings > Environment Variables:
//   CF_TURN_KEY_ID     the "Turn Token ID" of your Cloudflare TURN key
//   CF_TURN_API_TOKEN  the API token / key secret for that TURN key
// Option B (fallback): Metered. Set METERED_APP (e.g. homestudio) and METERED_SECRET.
// If both are set, Cloudflare is used first.
const hits = new Map(); // simple per-visitor limit (resets when the function restarts)
let cache = null;       // one set of credentials is reused for an hour

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const cfId = process.env.CF_TURN_KEY_ID, cfToken = process.env.CF_TURN_API_TOKEN;
  const app = process.env.METERED_APP, secret = process.env.METERED_SECRET;
  if (!(cfId && cfToken) && !(app && secret)) return res.status(500).json({ error: 'not configured' });

  const ip = (req.headers['x-forwarded-for'] || 'x').split(',')[0].trim();
  const now = Date.now(), recent = (hits.get(ip) || []).filter(t => now - t < 3600e3);
  if (recent.length >= 20) return res.status(429).json({ error: 'slow down' });
  hits.set(ip, [...recent, now]);
  if (cache && now - cache.at < 3600e3) return res.status(200).json(cache.ice);

  const fail = (step, status, body) => {
    // The provider's reason is shown here and in the Vercel logs (never your keys)
    const message = (body && (body.message || body.error || (body.errors && body.errors[0] && body.errors[0].message))) || null;
    console.error('turn', step, 'failed', status, JSON.stringify(body || {}).slice(0, 300));
    return res.status(502).json({ error: 'upstream', step, status, message });
  };
  const done = ice => { cache = { at: now, ice }; return res.status(200).json(ice); };

  try {
    if (cfId && cfToken) {
      const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(cfId)}/credentials/generate-ice-servers`, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + cfToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl: 6 * 3600 })
      });
      const j = await r.json().catch(() => null);
      const ice = Array.isArray(j) ? j : j && j.iceServers;
      if (!r.ok || !Array.isArray(ice) || !ice.length) return fail('cloudflare', r.status, j);
      return done(ice);
    }

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
    return done(ice);
  } catch (e) {
    return fail('network', 0, { message: String(e && e.message || e) });
  }
};
