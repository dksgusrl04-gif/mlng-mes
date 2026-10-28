"""PostgREST 문법 해석 · SQL 만들기 단위 시험 (DB 없이)  —  cd server/api && python -m pytest -q"""
import pytest

from app.rest import BadRequest, insert_sql, parse_filter, parse_query, select_sql, update_sql

CAT = {'mlng_lots': {'id': 'text', 'qty': 'integer', 'start_at': 'text', 'meta': 'jsonb'},
       'mlng_purchase_orders': {'id': 'text', 'status': 'text', 'signs': 'jsonb'}}


def s(x):
    return x.as_string(None)


def test_select_basic():
    q = parse_query('mlng_lots', [('select', 'id,qty'), ('start_at', 'gte.2026-05-01'), ('order', 'start_at.desc'), ('limit', '10')], 5000)
    stmt, args = select_sql(CAT, q)
    assert s(stmt) == 'SELECT "id", "qty" FROM "mlng_lots" WHERE "start_at" >= CAST(%s AS text) ORDER BY "start_at" DESC LIMIT %s OFFSET %s'
    assert args == ['2026-05-01', 10, 0]


def test_limit_capped():
    q = parse_query('mlng_lots', [('limit', '999999')], 5000)
    assert q.limit == 5000
    assert parse_query('mlng_lots', [], 300).limit == 300


def test_in_and_is_and_not():
    f = parse_filter('id', 'in.(A,"B,C",D)')
    assert f.op == 'in' and f.val == ['A', 'B,C', 'D']
    q = parse_query('mlng_lots', [('qty', 'is.null'), ('id', 'not.eq.X')], 100)
    stmt, args = select_sql(CAT, q)
    assert 'IS NULL' in s(stmt) and 'NOT ("id" = CAST(%s AS text))' in s(stmt) and args[0] == 'X'


@pytest.mark.parametrize('bad', ['id;drop table x', 'Id', '1abc', 'a b', 'id"--'])
def test_bad_names_rejected(bad):
    with pytest.raises(BadRequest):
        parse_query('mlng_lots', [('select', bad)], 100)
    with pytest.raises(BadRequest):
        parse_query(bad, [], 100)


def test_unknown_table_column():
    with pytest.raises(BadRequest) as e:
        select_sql(CAT, parse_query('pg_shadow', [], 10))
    assert e.value.status == 404
    with pytest.raises(BadRequest):
        select_sql(CAT, parse_query('mlng_lots', [('select', 'password')], 10))


def test_values_are_bound_not_inlined():
    q = parse_query('mlng_lots', [('id', "eq.X' or '1'='1")], 10)
    stmt, args = select_sql(CAT, q)
    assert "'1'='1" not in s(stmt) and args[0] == "X' or '1'='1"


def test_insert_jsonb_and_returning():
    stmt, args = insert_sql(CAT, 'mlng_lots', [{'id': 'A', 'meta': {'k': 1}}, {'id': 'B', 'qty': 3}], True)
    assert s(stmt).startswith('INSERT INTO "mlng_lots" ("id", "meta", "qty") VALUES (CAST(%s AS text), CAST(%s AS jsonb), CAST(%s AS integer)), (')
    assert s(stmt).endswith('RETURNING *') and args == ['A', '{"k": 1}', None, 'B', None, 3]


def test_update_requires_filter():
    with pytest.raises(BadRequest):
        update_sql(CAT, 'mlng_purchase_orders', {'status': 'approved'}, [], False)
    stmt, args = update_sql(CAT, 'mlng_purchase_orders', {'status': 'approved'}, [parse_filter('id', 'eq.PO-1')], True)
    assert s(stmt) == 'UPDATE "mlng_purchase_orders" SET "status" = CAST(%s AS text) WHERE "id" = CAST(%s AS text) RETURNING *'
    assert args == ['approved', 'PO-1']


def test_bad_operator():
    with pytest.raises(BadRequest):
        parse_filter('id', 'regex.abc')
    with pytest.raises(BadRequest):
        parse_filter('id', 'nodot')
