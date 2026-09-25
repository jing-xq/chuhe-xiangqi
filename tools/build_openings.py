# -*- coding: utf-8 -*-
"""开局谱库构建与校验工具。

用法：
    python build_openings.py          # 校验 + 自动补全 cn / m 双向字段，重建 index.json
    python build_openings.py --check  # 只校验不写文件（CI / 快速检查）

谱库格式（data/openings/*.json，index.json 除外）：
    {
      "id": "cp-pfm",
      "name": "中炮过河车对屏风马",
      "redOpening": "当头炮", "blackDefense": "屏风马",
      "fen": "初始局面 FEN（可省，默认开局）",
      "mainlineEndPly": 20,          # 主线 ch[0] 链长（半回合），= 入中局点
      "intro": "体系简介",
      "level": "入门",                # 难度标签
      "dev": [ {"m"/"cn": ..., "why": ..., "punish": ...} ],   # 根部脱谱（第 1 手前）
      "moves": [ { "m": "h2e2", "cn": "炮二平五", "c": "讲解",
                   "dev": [ {"m"/"cn", "why", "punish"} ],
                   "ch": [ ...子节点... ] } ]
    }

节点规则：
    m / cn 至少给一个；都给则必须一致。工具自动补齐缺失的一个。
    ch[0] 是主线续着，ch[1..] 是关键分支。dev 是对方脱谱教学着（合法且不与 ch 重复）。
    讲解 c 写「为什么」：出子原则、阵型要点、常见误走。
"""

import sys, os, json, copy, argparse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import xiangqi as x

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OPEN_DIR = os.path.join(ROOT, "data", "openings")
DEFAULT_FEN = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1"

FULLMAP = {}
for a, b in zip(u"０１２３４５６７８９", "0123456789"):
    FULLMAP[ord(a)] = b
for a, b in zip(u"ＡＢＣＤＥＦＧＨＩ", "abcdefghi"):
    FULLMAP[ord(a)] = b
# 繁体/异体棋子字 -> 简体
for a, b in {u"車": u"车", u"俥": u"车", u"馬": u"马", u"傌": u"马",
             u"砲": u"炮", u"炮": u"炮", u"帥": u"帅", u"將": u"将",
             u"士": u"士", u"仕": u"士", u"象": u"象", u"相": u"象",
             u"兵": u"兵", u"卒": u"卒"}.items():
    FULLMAP[ord(a)] = b

errors = []


def norm_cn(s):
    """记谱 token 归一：全角转半角、繁体转简体、去空白。"""
    s = (s or "").strip().translate(FULLMAP)
    return u"".join(s.split())


def resolve_move(board, side, node, path):
    """在给定局面把节点的着法解析为 (mv_text, cn)。m/cn 至少给一个。"""
    m_text = (node.get("m") or "").strip()
    cn_text = (node.get("cn") or "").strip()
    if not m_text and not cn_text:
        errors.append(u"%s: 节点缺少 m/cn" % path)
        return None
    if m_text:
        try:
            mv = x.parse_move(m_text)
        except ValueError as e:
            errors.append(u"%s: 着法 %s 无法解析 (%s)" % (path, m_text, e))
            return None
        if not x.is_legal(board, side, mv):
            errors.append(u"%s: 着法 %s 非法（局面 FEN: %s，轮 %s）"
                          % (path, m_text, x.board_to_fen(board, side), side))
            return None
        cn = x.chinese_move(board, side, mv)
        if cn_text and norm_cn(cn_text) != norm_cn(cn):
            errors.append(u"%s: cn=%s 与 m=%s（%s）不一致" % (path, cn_text, m_text, cn))
            return None
        return x.move_to_text(mv), cn
    # 只给了 cn：在合法着里唯一匹配
    want = norm_cn(cn_text)
    matches = []
    for mv in x.legal_moves(board, side):
        if norm_cn(x.chinese_move(board, side, mv)) == want:
            matches.append(mv)
    if not matches:
        errors.append(u"%s: cn=%s 在当前局面无匹配着法（FEN: %s）"
                      % (path, cn_text, x.board_to_fen(board, side)))
        return None
    if len(matches) > 1:
        errors.append(u"%s: cn=%s 有歧义（%d 个匹配），请改用 m 坐标着"
                      % (path, cn_text, len(matches)))
        return None
    return x.move_to_text(matches[0]), x.chinese_move(board, side, matches[0])


def walk_node(board, side, node, path, st):
    """校验并补全一个谱树节点；递归 ch；校验 dev。返回是否成功。"""
    res = resolve_move(board, side, node, path)
    if res is None:
        return False
    m_text, cn = res
    node["m"], node["cn"] = m_text, cn

    # 统计
    st["nodes"] += 1
    st["userNodes"][side] += 1
    if node.get("c"):
        st["comments"] += 1

    # 走子，得到对方局面
    mv = x.parse_move(m_text)
    nb = [row[:] for row in board]
    x.apply_move(nb, *mv)
    o = x.other(side)

    # ch 递归（ch[0] 主线）——先递归，子节点的 m/cn 在其中补全
    for i, c in enumerate(node.get("ch", [])):
        cpath = u"%s.ch[%d]" % (path, i)
        walk_node(nb, o, c, cpath, st)

    # dev：对方的脱谱着（合法、不与 ch 重复）；此时 ch 的 m 已补全
    ch_moves = set((c.get("m") or "").strip() for c in node.get("ch", []))
    for i, d in enumerate(node.get("dev", [])):
        dpath = u"%s.dev[%d]" % (path, i)
        dres = resolve_move(nb, o, d, dpath)
        if dres is None:
            continue
        dm, dcn = dres
        d["m"], d["cn"] = dm, dcn
        if dm in ch_moves:
            errors.append(u"%s: 脱谱着 %s 与谱着分支重复" % (dpath, dm))
        if not d.get("why") or not d.get("punish"):
            errors.append(u"%s: dev 缺少 why/punish 讲解文字" % dpath)

    return True


def mainline_len(moves):
    n, cur = 0, list(moves)
    while cur:
        n += 1
        cur = list(cur[0].get("ch", []))
    return n


def count_vars(moves):
    n = 0
    for node in moves:
        ch = node.get("ch", [])
        if len(ch) > 1:
            n += len(ch) - 1
        n += count_vars(ch)
    return n


def process(path_fn):
    with open(path_fn, encoding="utf-8") as f:
        data = json.load(f)
    name = os.path.basename(path_fn)
    before = json.dumps(data, ensure_ascii=False, sort_keys=True)

    fen = data.get("fen") or DEFAULT_FEN
    data["fen"] = fen
    board, side = x.parse_fen(fen)

    st = {"nodes": 0, "comments": 0, "userNodes": {"r": 0, "b": 0}}
    # 先解析谱树（m/cn 在其中补全），再校验根部 dev 查重
    for i, node in enumerate(data.get("moves", [])):
        walk_node(board, side, node, u"%s: moves[%d]" % (name, i), st)

    # 根部 dev（第 1 手前 = 先手方的脱谱着）
    root_moves = set((c.get("m") or "").strip() for c in data.get("moves", []))
    for i, d in enumerate(data.get("dev", [])):
        dpath = u"%s: dev[%d]" % (name, i)
        dres = resolve_move(board, side, d, dpath)
        if dres is None:
            continue
        dm, dcn = dres
        d["m"], d["cn"] = dm, dcn
        if dm in root_moves:
            errors.append(u"%s: 脱谱着 %s 与谱着重复" % (dpath, dm))
        if not d.get("why") or not d.get("punish"):
            errors.append(u"%s: dev 缺少 why/punish" % dpath)

    if not data.get("moves"):
        errors.append(u"%s: 空谱（moves 为空）" % name)

    ml = mainline_len(data.get("moves", []))
    declared = data.get("mainlineEndPly")
    if declared is not None and declared != ml:
        print(u"[修正] %s: mainlineEndPly %s -> %d" % (name, declared, ml))
    data["mainlineEndPly"] = ml

    meta = {
        "id": data.get("id") or name.replace(".json", ""),
        "name": data.get("name", ""),
        "redOpening": data.get("redOpening", ""),
        "blackDefense": data.get("blackDefense", ""),
        "file": "data/openings/" + name,
        "mainlineEndPly": ml,
        "mainlinePlies": ml,
        "vars": count_vars(data.get("moves", [])),
        "comments": st["comments"],
        "userNodes": st["userNodes"],
        "level": data.get("level", u"入门"),
    }
    after = json.dumps(data, ensure_ascii=False, sort_keys=True)
    return data, meta, before != after


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="只校验不写文件")
    ap.add_argument("--only", metavar="ID", help="只处理指定 id 的体系（其余跳过，不重建 index）")
    args = ap.parse_args()

    if not os.path.isdir(OPEN_DIR):
        print(u"目录不存在: %s" % OPEN_DIR)
        return 1

    metas, dirty = [], []
    for fn in sorted(os.listdir(OPEN_DIR)):
        if not fn.endswith(".json") or fn == "index.json":
            continue
        if args.only and fn.replace(".json", "") != args.only:
            continue
        full = os.path.join(OPEN_DIR, fn)
        try:
            data, meta, changed = process(full)
        except Exception as e:
            errors.append(u"%s: 解析失败 %s" % (fn, e))
            continue
        metas.append(meta)
        if changed:
            dirty.append((full, data))

    if errors:
        for e in errors:
            print(u"[错误] " + e)
        print(u"\n共 %d 个错误" % len(errors))
        return 1

    if not args.check:
        for full, data in dirty:
            with open(full, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=1)
                f.write("\n")
            print(u"[写回] %s（补齐 m/cn）" % os.path.basename(full))
        if not args.only:
            index = {"systems": metas}
            ipath = os.path.join(OPEN_DIR, "index.json")
            with open(ipath, "w", encoding="utf-8") as f:
                json.dump(index, f, ensure_ascii=False, indent=1)
                f.write("\n")
            print(u"[生成] index.json（%d 个体系）" % len(metas))

    print(json.dumps({"systems": len(metas),
                      "userNodes": {m["id"]: m["userNodes"] for m in metas}},
                     ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
