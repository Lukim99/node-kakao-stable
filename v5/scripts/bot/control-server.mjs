import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';

const DASHBOARD = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Kakao Bot Control</title><style>
body{font-family:system-ui,sans-serif;max-width:680px;margin:48px auto;padding:0 20px;background:#f5f5f5;color:#181818}
main{background:white;border-radius:18px;padding:28px;box-shadow:0 8px 30px #0001}h1{margin-top:0}
.row{display:flex;gap:10px;flex-wrap:wrap}input{flex:1;min-width:240px;padding:12px;border:1px solid #bbb;border-radius:9px}
button{padding:12px 18px;border:0;border-radius:9px;font-weight:700;cursor:pointer}.on{background:#fee500}.off{background:#333;color:white}
pre{padding:16px;background:#111;color:#d8ffd8;border-radius:10px;overflow:auto;min-height:180px}.hint{color:#666;font-size:14px}
</style></head><body><main><h1>Kakao Bot Control</h1>
<p class="hint">관리자 토큰은 브라우저 sessionStorage에만 보관됩니다.</p>
<div class="row"><input id="token" type="password" autocomplete="current-password" placeholder="BOT_ADMIN_TOKEN">
<button id="refresh">상태 확인</button></div><p><button class="on" id="on">Bot On</button> <button class="off" id="off">Bot Off</button></p>
<pre id="status">토큰을 입력한 뒤 상태를 확인하세요.</pre></main><script>
const token=document.querySelector('#token'),out=document.querySelector('#status');token.value=sessionStorage.getItem('bot-token')||'';
async function call(path,method='GET'){sessionStorage.setItem('bot-token',token.value);const r=await fetch(path,{method,headers:{Authorization:'Bearer '+token.value}});const body=await r.json();if(!r.ok)throw new Error(body.error||('HTTP '+r.status));out.textContent=JSON.stringify(body,null,2);return body}
document.querySelector('#refresh').onclick=()=>call('/api/status').catch(e=>out.textContent=e.message);
document.querySelector('#on').onclick=()=>call('/api/bot/on','POST').catch(e=>out.textContent=e.message);
document.querySelector('#off').onclick=()=>call('/api/bot/off','POST').catch(e=>out.textContent=e.message);
setInterval(()=>{if(token.value)call('/api/status').catch(()=>{})},5000);
</script></body></html>`;

function authorized(request, token) {
  if (token.length === 0) return true;
  const header = request.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(header.slice(7));
  const expected = Buffer.from(token);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function json(response, status, value) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(JSON.stringify(value));
}

export async function createBotControlServer(options) {
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 3_000;
  const token = options.token ?? '';
  if (host !== '127.0.0.1' && host !== '::1' && token.length < 20) {
    throw new Error('A BOT_ADMIN_TOKEN of at least 20 characters is required for non-loopback control');
  }

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    if (request.method === 'GET' && url.pathname === '/') {
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'content-security-policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'",
        'x-content-type-options': 'nosniff',
        'x-frame-options': 'DENY',
      });
      response.end(DASHBOARD);
      return;
    }
    if (request.method === 'GET' && url.pathname === '/healthz') {
      json(response, 200, { ok: true });
      return;
    }
    if (!authorized(request, token)) {
      json(response, 401, { error: 'Unauthorized' });
      return;
    }
    try {
      if (request.method === 'GET' && url.pathname === '/api/status') {
        json(response, 200, options.controller.status());
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/bot/on') {
        json(response, 200, await options.controller.start());
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/bot/off') {
        json(response, 200, await options.controller.stop());
        return;
      }
      json(response, 404, { error: 'Not found' });
    } catch (error) {
      options.log?.('control-error', { message: error instanceof Error ? error.message : String(error) });
      json(response, 500, { error: 'Bot control operation failed' });
    }
  });

  await new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolvePromise);
  });
  const address = server.address();
  return {
    host,
    port: typeof address === 'object' && address !== null ? address.port : port,
    close: async () => await new Promise((resolvePromise, reject) =>
      server.close(error => error ? reject(error) : resolvePromise()),
    ),
  };
}
