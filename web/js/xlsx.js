/* 엑셀(.xlsx) 만들기 — 외부 라이브러리 없이 (압축 없는 ZIP + SpreadsheetML)
 *   MLNG.xlsx.download('생산일보_2026-10-27.xlsx', [{ name: '생산실적', rows: [[{ v: '생산 일보', s: 'title' }], ['공정', '계획'], ['프레스', 1200]], widths: [14, 10], merges: ['A1:F1'], head: 2 }])
 *   셀: 값(문자 · 숫자) 또는 { v, s: 'title' | 'h' | 'n' | 'p' | 't' }  — h 머리 · n 숫자(#,##0) · p 백분율(0.0%) · t 글자
 *   MLNG.xlsx.fromTable(table, title) — 화면의 표를 그대로 한 장으로
 */
(function () {
  'use strict';
  const enc = new TextEncoder();
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  function zip(files) {   // [{ name, data: Uint8Array }] → Blob (STORE)
    const parts = [], cen = []; let off = 0;
    const u16 = v => [v & 255, (v >>> 8) & 255], u32 = v => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
    files.forEach(f => {
      const nm = enc.encode(f.name), c = crc32(f.data), sz = f.data.length;
      const head = new Uint8Array([...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(c), ...u32(sz), ...u32(sz), ...u16(nm.length), ...u16(0)]);
      parts.push(head, nm, f.data);
      cen.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(c), ...u32(sz), ...u32(sz), ...u16(nm.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(off)]), nm);
      off += head.length + nm.length + sz;
    });
    const cenSize = cen.reduce((s, x) => s + x.length, 0);
    const end = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cenSize), ...u32(off), ...u16(0)]);
    return new Blob([...parts, ...cen, end], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  const X = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  const col = i => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  const SID = { t: 3, h: 1, n: 2, p: 5, title: 4, sub: 6, nb: 7 };
  const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="0.0%"/></numFmts>
<fonts count="4"><font><sz val="10"/><name val="맑은 고딕"/></font><font><b/><sz val="10"/><name val="맑은 고딕"/></font><font><b/><sz val="16"/><name val="맑은 고딕"/></font><font><sz val="9"/><color rgb="FF64748B"/><name val="맑은 고딕"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEEF0F5"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFB8BFCC"/></left><right style="thin"><color rgb="FFB8BFCC"/></right><top style="thin"><color rgb="FFB8BFCC"/></top><bottom style="thin"><color rgb="FFB8BFCC"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="8"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="3" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="3" fontId="1" fillId="2" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  function sheetXml(sh) {
    const rows = sh.rows.map((r, ri) => `<row r="${ri + 1}">${r.map((c, ci) => {
      if (c == null || c === '') return '';
      const o = typeof c === 'object' ? c : { v: c }, ref = col(ci) + (ri + 1);
      const isH = ri < (sh.head || 0) || (sh.headRows || [sh.headRow]).includes(ri), s = o.s || (isH ? 'h' : typeof o.v === 'number' ? 'n' : 't');
      if (typeof o.v === 'number' && isFinite(o.v)) return `<c r="${ref}" s="${SID[s] ?? 2}"><v>${o.v}</v></c>`;
      return `<c r="${ref}" s="${SID[s] ?? 3}" t="inlineStr"><is><t xml:space="preserve">${X(o.v)}</t></is></c>`;
    }).join('')}</row>`).join('');
    const cols = sh.widths ? `<cols>${sh.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
    const mg = sh.merges && sh.merges.length ? `<mergeCells count="${sh.merges.length}">${sh.merges.map(m => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '';
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews>${cols}<sheetData>${rows}</sheetData>${mg}<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>`;
  }
  function build(sheets) {
    const n = sheets.length, safe = s => String(s).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet';
    const files = [
      ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`],
      ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
      ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${X(safe(s.name))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`],
      ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
      ['xl/styles.xml', STYLES],
    ].concat(sheets.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)]));
    return zip(files.map(([name, txt]) => ({ name, data: enc.encode(txt) })));
  }
  function download(name, sheets) {
    const blob = build(sheets), a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500); return blob;
  }
  // 화면 표 → 시트 (머리 1줄 · 숫자 칸은 숫자로)
  const num = t => { const s = t.replace(/[,\s]/g, '').replace(/(원|개|건|분|h|PPM|ppm|LOT)$/i, ''); return /^-?\d+(\.\d+)?$/.test(s) ? +s : /^-?\d+(\.\d+)?%$/.test(s) ? +(+s.slice(0, -1) / 100).toFixed(6) : null; };
  function fromTable(table, title) {
    const cellTxt = c => c.innerText.replace(/\s*\n+\s*/g, ' / ').trim();
    const head = [...table.querySelectorAll('thead th')].map(cellTxt);
    const body = [...table.querySelectorAll('tbody tr')].filter(r => !r.querySelector('.empty')).map(r => [...r.children].map(td => { const t = cellTxt(td), v = num(t); return v == null ? t : (/%$/.test(t.trim()) ? { v, s: 'p' } : v); }));
    const keep = head.map((h, i) => h || body.some(r => r[i] !== '' && r[i] != null)), pick = r => r.filter((_, i) => keep[i]);
    const H = pick(head), rows = [[{ v: title, s: 'title' }], [{ v: `${(window.MLNG.S || {}).factory ? MLNG.S.factory.name : ''} · 출력 ${new Date().toLocaleString('sv-SE').slice(0, 16)}`, s: 'sub' }], [], H].concat(body.map(pick));
    const widths = H.map((h, i) => Math.min(48, Math.max(8, h.length * 2 + 2, ...body.map(r => String(typeof pick(r)[i] === 'object' ? pick(r)[i].v : pick(r)[i] ?? '').length * 1.3))));
    return { name: title, rows, widths, merges: [`A1:${col(Math.max(0, H.length - 1))}1`], head: 0, headRow: 3 };
  }
  window.MLNG_XLSX = { build, download, fromTable, col };
})();
