// supabase/functions/mlng-ask/index.ts 의 SYSTEM · TOOLS · MODEL 을 server/api/app/ask_spec.json 으로 옮긴다
// → Supabase Edge Function 과 자체 서버 FastAPI 가 같은 지시 · 도구를 쓴다 (한쪽만 고치는 실수 방지)
//   node server/scripts/export_ask_spec.mjs          다시 만들기
//   node server/scripts/export_ask_spec.mjs --check  다르면 실패 (CI)
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const src = fs.readFileSync(path.join(root, 'supabase/functions/mlng-ask/index.ts'), 'utf8');
const grab = re => { const m = src.match(re); if (!m) throw new Error('찾지 못함: ' + re); return m[1]; };
const SYSTEM = new Function('return `' + grab(/const SYSTEM = `([\s\S]*?)`;/) + '`')();
const TOOLS = new Function('return ' + grab(/const TOOLS = (\[[\s\S]*?\n\]);/))();
const MODEL = grab(/Deno\.env\.get\('ASK_MODEL'\) \|\| '([^']+)'/);
const out = JSON.stringify({ model: MODEL, system: SYSTEM, tools: TOOLS }, null, 1) + '\n';
const dst = path.join(root, 'server/api/app/ask_spec.json');
if (process.argv.includes('--check')) { if (!fs.existsSync(dst) || fs.readFileSync(dst, 'utf8') !== out) { console.error('[실패] ask_spec.json 이 index.ts 와 다릅니다 — node server/scripts/export_ask_spec.mjs'); process.exit(1); } console.log('[확인] ask_spec.json 일치'); }
else { fs.writeFileSync(dst, out); console.log(`[완료] 도구 ${TOOLS.length}개 → server/api/app/ask_spec.json`); }
