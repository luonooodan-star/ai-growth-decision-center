import { createHash, randomBytes } from 'node:crypto';
import {
  authenticateCenterAsync,
  centerCredentialRevision,
} from './center-identity';

export class CenterSessions {
  private sessions = new Map<
    string,
    { username: string; revision: string; until: number }
  >();
  constructor(
    private legacy: string,
    private root = process.cwd(),
  ) {}
  private key(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }
  async login(username: string, password: string): Promise<string | undefined> {
    const revision = await centerCredentialRevision(this.legacy, this.root);
    if (
      !revision ||
      !(await authenticateCenterAsync(
        username,
        password,
        this.legacy,
        this.root,
      ))
    )
      return;
    if (revision !== (await centerCredentialRevision(this.legacy, this.root)))
      return;
    for (const [key, value] of this.sessions)
      if (value.until <= Date.now()) this.sessions.delete(key);
    if (this.sessions.size >= 1000) return;
    const token = randomBytes(32).toString('hex');
    this.sessions.set(this.key(token), {
      username,
      revision,
      until: Date.now() + 8 * 3600000,
    });
    return token;
  }
  async resolve(token: string | undefined) {
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return;
    const key = this.key(token),
      session = this.sessions.get(key);
    if (!session) return;
    if (
      session.until <= Date.now() ||
      session.revision !==
        (await centerCredentialRevision(this.legacy, this.root))
    ) {
      this.sessions.delete(key);
      return;
    }
    return { username: session.username, sessionId: key.slice(0, 24) };
  }
  logout(token: string | undefined) {
    if (token) this.sessions.delete(this.key(token));
  }
}

export const centerLoginPage = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>登录 · AI 增长决策中心</title>
<style>body{margin:0;background:#f7f9fc;color:#17233b;font:16px system-ui}main{max-width:380px;margin:12vh auto;padding:36px;background:white;border:1px solid #dde4ef;border-radius:20px}label{display:block;margin-top:20px}input,button{box-sizing:border-box;width:100%;padding:12px;margin-top:8px;border:1px solid #ccd5e4;border-radius:8px;font:inherit}button{background:#275ef5;color:white;cursor:pointer;margin-top:24px}p{color:#637793;line-height:1.6}#error{color:#b42318}</style>
<main><h1>AI 增长决策中心</h1><p>登录 / 切换账户<br>使用自己的 Doris 与 Meta 授权；团队知识共用。</p><form id="login"><label>用户名<input name="username" autocomplete="username" required maxlength="40"></label><label>密码<input name="password" type="password" autocomplete="current-password" required maxlength="1024"></label><button>登录</button><p id="error" role="alert"></p></form><p>同一浏览器的其他页面会同步切换账户。退出不会撤销已配置的个人授权。</p></main>
<script>document.getElementById('login').onsubmit=async function(e){e.preventDefault();const button=this.querySelector('button');button.disabled=true;document.getElementById('error').textContent='';try{const r=await fetch('/api/center/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(this)))});if(!r.ok)throw Error('登录失败，请检查用户名、密码或稍后重试');try{localStorage.setItem('center-session-changed',String(Date.now()))}catch{}location.replace('/data')}catch(e){document.getElementById('error').textContent=e.message;button.disabled=false}};</script></html>`;
