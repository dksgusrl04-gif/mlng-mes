"""web/ 폴더를 한 파일(preview.html)로 묶는다 — 더블클릭으로 바로 열리는 데모.
서버도, Supabase 도, 인터넷도 필요 없다. 고객 시연·발표용.

  python build_preview.py
"""
import base64, json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(os.path.dirname(HERE), 'web')
OUT = os.path.join(os.path.dirname(HERE), 'preview.html')


def read(p):
    return open(os.path.join(WEB, p), encoding='utf-8').read()


def main():
    html = read('index.html')
    css = read('css/style.css')
    html = re.sub(r'<link rel="stylesheet" href="css/style\.css(\?v=\d+)?">', lambda m: f'<style>\n{css}\n</style>', html)
    demo = json.load(open(os.path.join(WEB, 'data', 'demo.json'), encoding='utf-8'))
    cfg = read('js/config.js')
    cfg = re.sub(r"SUPABASE_URL: '[^']*'", "SUPABASE_URL: ''", cfg)       # 미리보기는 언제나 데모 모드
    cfg = re.sub(r"SUPABASE_ANON_KEY: '[^']*'", "SUPABASE_ANON_KEY: ''", cfg)
    js = ['data.js', 'core.js', 'mod_common.js', 'mod_line.js', 'mod_press.js', 'mod_weld.js', 'mod_heat.js', 'mod_mach.js', 'mod_insp.js', 'mod_plan.js', 'catalog.js', 'mod_buy.js', 'mod_ask.js', 'vendor/qrcode.js', 'trust.js', 'mod_net.js', 'mod_pass.js', 'mod_deal.js', 'mod_agent.js', 'mod_sync.js', 'mod_fed.js', 'decide.js', 'mod_gate.js', 'mod_case.js', 'mod_cost.js', 'mod_whatif.js', 'mod_replay.js', 'mod_shift.js', 'mod_palette.js', 'boot.js']
    scripts = (f'<script>\n{cfg}\n</script>\n<script>window.MLNG_DEMO = {json.dumps(demo, ensure_ascii=False, separators=(",", ":"))};</script>\n'
               + '\n'.join(f'<script>\n{read("js/" + j)}\n</script>' for j in js))
    html = re.sub(r'<script src="js/config\.js(\?v=\d+)?"></script>.*<script src="js/boot\.js(\?v=\d+)?"></script>', lambda m: scripts, html, flags=re.S)
    open(OUT, 'w', encoding='utf-8').write(html)
    print(f'[완료] {OUT} ({os.path.getsize(OUT) / 1024:.0f} KB)')


if __name__ == '__main__':
    main()
