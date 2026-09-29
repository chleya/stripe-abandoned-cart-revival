interface Env {
  DB: D1Database;
  STRIPE_WEBHOOK_SECRET: string;
  RESEND_API_KEY: string;
  RESEND_FROM: string;
  REVIVE_DISCOUNT_CODE?: string;
}
interface StripeEvent { id: string; type: string; data: { object: Record<string, unknown> } }
interface Session { id: string; customer_details?: { email?: string }; customer_email?: string; after_expiration?: { recovery?: { url?: string } }; created?: number; }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: {'content-type':'application/json'} });
const text = (body: string, status = 200) => new Response(body, { status, headers: {'content-type':'text/plain'} });
function hex(bytes: ArrayBuffer): string { return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join(''); }
async function verifyStripeSignature(payload: string, header: string, secret: string): Promise<boolean> {
  const parts = Object.fromEntries(header.split(',').map(part => part.split('=')));
  if (!parts.t || !parts.v1) return false;
  const age = Math.abs(Date.now() / 1000 - Number(parts.t));
  if (!Number.isFinite(age) || age > 300) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), {name:'HMAC', hash:'SHA-256'}, false, ['sign']);
  const sig = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${parts.t}.${payload}`)));
  return sig === parts.v1;
}
async function sendRecoveryEmail(env: Env, email: string, url: string, discount?: string): Promise<void> {
  const discountBlock = discount ? `<p>Use code <strong>${discount}</strong> for 15% off.</p>` : '';
  const html = `<p>You left something behind.</p><p><a href="${url}">Resume your checkout in one click</a>.</p>${discountBlock}<p>If you already completed your purchase, you can ignore this message.</p>`;
  const response = await fetch('https://api.resend.com/emails', {method:'POST', headers:{'Authorization':`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json'}, body: JSON.stringify({from:env.RESEND_FROM, to:[email], subject:'Complete your checkout', html})});
  if (!response.ok) throw new Error(`Resend returned ${response.status}`);
}
async function handleEvent(env: Env, event: StripeEvent): Promise<Response> {
  const session = event.data.object as unknown as Session;
  const email = session.customer_details?.email ?? session.customer_email;
  if (!email || !session.id) return json({ignored:true, reason:'missing customer email or session id'});
  const now = Math.floor(Date.now()/1000);
  if (event.type === 'checkout.session.completed') {
    await env.DB.prepare(`UPDATE cart_sessions SET status='completed', completed_at=?, updated_at=? WHERE customer_email=? AND status IN ('expired','recovered')`).bind(now, now, email).run();
    await env.DB.prepare(`INSERT INTO cart_sessions (id,customer_email,status,recovery_url,stripe_created_at,updated_at,completed_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status='completed',completed_at=excluded.completed_at,updated_at=excluded.updated_at`).bind(session.id,email,'completed','',session.created ?? now,now,now).run();
    return json({ok:true, action:'marked_completed'});
  }
  if (event.type !== 'checkout.session.expired') return json({ignored:true, reason:'unsupported event'});
  const recoveryUrl = session.after_expiration?.recovery?.url;
  if (!recoveryUrl) return json({ignored:true, reason:'Stripe recovery URL unavailable'});
  const alreadyCompleted = await env.DB.prepare(`SELECT 1 FROM cart_sessions WHERE customer_email=? AND status='completed' LIMIT 1`).bind(email).first();
  if (alreadyCompleted) {
    await env.DB.prepare(`INSERT INTO cart_sessions (id,customer_email,status,recovery_url,stripe_created_at,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status='suppressed',updated_at=excluded.updated_at`).bind(session.id,email,'suppressed',recoveryUrl,session.created ?? now,now).run();
    return json({ok:true, action:'suppressed_completed_customer'});
  }
  const discount = env.REVIVE_DISCOUNT_CODE || undefined;
  await env.DB.prepare(`INSERT INTO cart_sessions (id,customer_email,status,recovery_url,discount_code,stripe_created_at,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET recovery_url=excluded.recovery_url,updated_at=excluded.updated_at`).bind(session.id,email,'expired',recoveryUrl,discount,session.created ?? now,now).run();
  try {
    await sendRecoveryEmail(env,email,recoveryUrl,discount);
    await env.DB.prepare(`UPDATE cart_sessions SET status='recovered',email_sent_at=?,updated_at=? WHERE id=? AND status='expired'`).bind(now,now,session.id).run();
    return json({ok:true, action:'recovery_email_sent'});
  } catch (error) {
    console.error('recovery email failed', error);
    return json({ok:false, action:'stored_email_failed'}, 502);
  }
}
export default { async fetch(request: Request, env: Env): Promise<Response> {
  if (request.method === 'GET') return text('stripe-abandoned-cart-revival is ready');
  if (request.method !== 'POST' || new URL(request.url).pathname !== '/webhooks/stripe') return text('Not found', 404);
  const payload = await request.text();
  const signature = request.headers.get('Stripe-Signature');
  if (!signature || !(await verifyStripeSignature(payload, signature, env.STRIPE_WEBHOOK_SECRET))) return text('Invalid signature', 400);
  try { return await handleEvent(env, JSON.parse(payload) as StripeEvent); } catch (error) { console.error('webhook error', error); return json({error:'internal_error'}, 500); }
}};
