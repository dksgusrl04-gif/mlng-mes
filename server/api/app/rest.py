"""PostgREST(= Supabase REST) 문법의 필요한 부분만 구현한다.

화면(web/js/data.js)은 Supabase 에 보내던 요청을 그대로 이 서버에 보낸다:
  GET   /rest/v1/mlng_lots?select=*&start_at=gte.2026-05-01&order=start_at.desc&limit=3000
  POST  /rest/v1/mlng_inspections            (본문: 객체 또는 객체 배열)
  PATCH /rest/v1/mlng_purchase_orders?id=eq.PO-001

안전 장치
  · 표 · 열 이름은 DB 목록(information_schema)에 있는 것만 — 그 밖은 400
  · 값은 모두 바인딩 변수로 (SQL 문자열에 붙이지 않는다) → SQL 인젝션 불가
  · 실행은 DB 역할 anon 으로 (SET LOCAL ROLE) → 쓸 수 있는 표 · 행은 DB 의 GRANT · RLS 가 정한다
  · 조건 없는 PATCH 거부, 한 번에 읽는 행 수 상한
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any

from psycopg import sql

NAME = re.compile(r'^[a-z_][a-z0-9_]*$')
OPS = {'eq': '=', 'neq': '<>', 'gt': '>', 'gte': '>=', 'lt': '<', 'lte': '<=', 'like': 'LIKE', 'ilike': 'ILIKE'}
RESERVED = {'select', 'order', 'limit', 'offset', 'on_conflict', 'columns'}


class BadRequest(Exception):
    def __init__(self, msg: str, code: str = 'PGRST100', status: int = 400):
        super().__init__(msg)
        self.msg, self.code, self.status = msg, code, status


@dataclass
class Filter:
    col: str
    op: str
    val: Any
    neg: bool = False


@dataclass
class Query:
    table: str
    cols: list[str] | None = None            # None = *
    filters: list[Filter] = field(default_factory=list)
    order: list[tuple[str, bool, str | None]] = field(default_factory=list)   # (열, 내림차순, nulls first/last)
    limit: int | None = None
    offset: int | None = None


def _name(s: str, what: str) -> str:
    if not NAME.match(s or ''):
        raise BadRequest(f'{what} 이름이 올바르지 않습니다: {s!r}')
    return s


def _unquote(v: str) -> str:
    return v[1:-1].replace('\\"', '"') if len(v) >= 2 and v[0] == v[-1] == '"' else v


def parse_filter(col: str, raw: str) -> Filter:
    """col=op.value  /  col=not.op.value  /  col=in.(a,b)  /  col=is.null"""
    _name(col, '열')
    neg = raw.startswith('not.')
    if neg:
        raw = raw[4:]
    op, dot, val = raw.partition('.')
    if not dot:
        raise BadRequest(f'조건 형식이 올바르지 않습니다: {col}={raw}')
    if op in OPS:
        return Filter(col, op, val, neg)
    if op == 'is':
        if val not in ('null', 'true', 'false'):
            raise BadRequest('is 는 null · true · false 만 됩니다')
        return Filter(col, 'is', val, neg)
    if op == 'in':
        if not (val.startswith('(') and val.endswith(')')):
            raise BadRequest('in 은 (a,b,c) 형식입니다')
        items = [_unquote(x.strip()) for x in re.findall(r'"(?:[^"\\]|\\.)*"|[^,]+', val[1:-1])]
        return Filter(col, 'in', items, neg)
    raise BadRequest(f'지원하지 않는 연산자: {op}')


def parse_query(table: str, params: list[tuple[str, str]], max_rows: int) -> Query:
    q = Query(_name(table, '표'))
    for k, v in params:
        if k == 'select':
            cols = [c.strip() for c in v.split(',') if c.strip()]
            q.cols = None if cols == ['*'] or not cols else [_name(c, '열') for c in cols]
        elif k == 'order':
            for part in v.split(','):
                bits = part.strip().split('.')
                col, desc, nulls = _name(bits[0], '열'), False, None
                for b in bits[1:]:
                    if b in ('asc', 'desc'):
                        desc = b == 'desc'
                    elif b in ('nullsfirst', 'nullslast'):
                        nulls = 'FIRST' if b == 'nullsfirst' else 'LAST'
                    else:
                        raise BadRequest(f'정렬 형식이 올바르지 않습니다: {part}')
                q.order.append((col, desc, nulls))
        elif k in ('limit', 'offset'):
            if not v.isdigit():
                raise BadRequest(f'{k} 는 숫자입니다')
            setattr(q, k, int(v))
        elif k in RESERVED:
            continue
        else:
            q.filters.append(parse_filter(k, v))
    q.limit = min(q.limit if q.limit is not None else max_rows, max_rows)
    return q


# ── SQL 만들기 (열 이름은 catalog 로 확인, 값은 열 타입으로 CAST 한 바인딩 변수)
Catalog = dict[str, dict[str, str]]       # 표 → {열: 타입}


def _cols(cat: Catalog, table: str) -> dict[str, str]:
    if table not in cat:
        raise BadRequest(f'표가 없습니다: {table}', 'PGRST205', 404)
    return cat[table]


def _check(cols: dict[str, str], c: str, table: str) -> str:
    if c not in cols:
        raise BadRequest(f'{table} 에 {c} 열이 없습니다', '42703')
    return c


def where_sql(cat: Catalog, table: str, filters: list[Filter]):
    cols, parts, args = _cols(cat, table), [], []
    for f in filters:
        typ = cols[_check(cols, f.col, table)]
        ident = sql.Identifier(f.col)
        if f.op == 'is':
            frag = sql.SQL('{} IS {}').format(ident, sql.SQL(f.val.upper()))
        elif f.op == 'in':
            frag = sql.SQL('{} = ANY(CAST(%s AS {}[]))').format(ident, sql.SQL(typ))
            args.append(list(f.val))
        else:
            frag = sql.SQL('{} {} CAST(%s AS {})').format(ident, sql.SQL(OPS[f.op]), sql.SQL(typ if f.op not in ('like', 'ilike') else 'text'))
            args.append(f.val.replace('*', '%') if f.op in ('like', 'ilike') else f.val)
        parts.append(sql.SQL('NOT ({})').format(frag) if f.neg else frag)
    return (sql.SQL(' WHERE ') + sql.SQL(' AND ').join(parts)) if parts else sql.SQL(''), args


def select_sql(cat: Catalog, q: Query):
    cols = _cols(cat, q.table)
    sel = sql.SQL('*') if q.cols is None else sql.SQL(', ').join(sql.Identifier(_check(cols, c, q.table)) for c in q.cols)
    where, args = where_sql(cat, q.table, q.filters)
    order = sql.SQL('')
    if q.order:
        order = sql.SQL(' ORDER BY ') + sql.SQL(', ').join(
            sql.SQL('{} {}{}').format(sql.Identifier(_check(cols, c, q.table)), sql.SQL('DESC' if d else 'ASC'), sql.SQL(f' NULLS {n}' if n else ''))
            for c, d, n in q.order)
    tail = sql.SQL(' LIMIT %s OFFSET %s')
    return sql.SQL('SELECT {} FROM {}{}{}').format(sel, sql.Identifier(q.table), where, order) + tail, args + [q.limit, q.offset or 0]


def _val(v: Any, typ: str):
    """JSON 값 → 바인딩 값 (객체 · 배열은 JSON 문자열로 넘기고 열 타입으로 CAST)"""
    if isinstance(v, (dict, list)) and typ in ('jsonb', 'json'):
        return json.dumps(v, ensure_ascii=False)
    if isinstance(v, list):
        return v
    if isinstance(v, dict):
        return json.dumps(v, ensure_ascii=False)
    return v


def insert_sql(cat: Catalog, table: str, rows: list[dict], returning: bool):
    cols = _cols(cat, table)
    if not rows or not all(isinstance(r, dict) and r for r in rows):
        raise BadRequest('본문은 비어 있지 않은 객체(또는 객체 배열)여야 합니다')
    names = sorted({k for r in rows for k in r})
    for n in names:
        _check(cols, _name(n, '열'), table)
    one = sql.SQL('(') + sql.SQL(', ').join(sql.SQL('CAST(%s AS {})').format(sql.SQL(cols[n])) for n in names) + sql.SQL(')')
    stmt = sql.SQL('INSERT INTO {} ({}) VALUES ').format(sql.Identifier(table), sql.SQL(', ').join(map(sql.Identifier, names)))
    stmt += sql.SQL(', ').join([one] * len(rows))
    if returning:
        stmt += sql.SQL(' RETURNING *')
    args = [_val(r.get(n), cols[n]) for r in rows for n in names]
    return stmt, args


def update_sql(cat: Catalog, table: str, body: dict, filters: list[Filter], returning: bool):
    cols = _cols(cat, table)
    if not filters:
        raise BadRequest('조건 없는 수정은 거부합니다 (예: ?id=eq.값)', 'PGRST106')
    if not isinstance(body, dict) or not body:
        raise BadRequest('본문은 비어 있지 않은 객체여야 합니다')
    sets, args = [], []
    for k, v in body.items():
        typ = cols[_check(cols, _name(k, '열'), table)]
        sets.append(sql.SQL('{} = CAST(%s AS {})').format(sql.Identifier(k), sql.SQL(typ)))
        args.append(_val(v, typ))
    where, wargs = where_sql(cat, table, filters)
    stmt = sql.SQL('UPDATE {} SET {}{}').format(sql.Identifier(table), sql.SQL(', ').join(sets), where)
    if returning:
        stmt += sql.SQL(' RETURNING *')
    return stmt, args + wargs
