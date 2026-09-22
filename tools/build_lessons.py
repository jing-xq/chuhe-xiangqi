# -*- coding: utf-8 -*-
"""从鹏飞象棋 School.zip 解析全部 .pfc 课程，生成前端用 JSON 数据。

用法：python build_lessons.py
输出：../data/lessons/<分类>/<序号>.json 与 ../data/index.json
"""
import json
import os
import re
import sys
import zipfile
from xml.etree import ElementTree

import xiangqi as x

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ZIP_PATH = r"D:\PengfeiChess\PengfeiChess-5.8.8.8\App\School\School.zip"
OUT_DIR = os.path.join(ROOT, "data", "lessons")


def decode_name(name):
    """zip 内文件名为 GBK 编码被误存为 cp437，还原之。"""
    raw = name.encode("cp437", errors="replace")
    try:
        return raw.decode("gbk")
    except UnicodeDecodeError:
        return raw.decode("utf-8", errors="replace")


def strip_ns(xml_text):
    # .pfc 无命名空间；防御性去除
    return re.sub(r'xmlns="[^"]*"\s*', "", xml_text)


def node_to_dict(el, board, side):
    """递归转换 <n m c> 节点；用棋盘推演校验着法并生成中文着法。
    返回 (dict, board, side)，board/side 为该节点走子后的状态。"""
    mv_text = el.get("m", "").strip()
    if not mv_text:
        raise ValueError("缺 m 属性")
    mv = x.parse_move(mv_text)
    if not x.is_legal(board, side, mv):
        raise ValueError("非法着法 %s" % mv_text)
    cn = x.chinese_move(board, side, mv)
    x.apply_move(board, *mv)
    side = x.other(side)
    node = {"m": mv_text, "cn": cn}
    comment = (el.get("c") or "").strip()
    if comment:
        node["c"] = comment
    children = [node_to_dict(ch, [r[:] for r in board], side) for ch in el.findall("n")]
    # node_to_dict 里每个子节点自己推演棋盘；注意上面的调用传的是副本，主棋盘保持本节点之后状态
    parsed = [c[0] for c in children]
    if parsed:
        node["ch"] = parsed
    return node, board, side


def convert(xml_text):
    xml_text = strip_ns(xml_text.lstrip("\ufeff"))
    root = ElementTree.fromstring(xml_text)
    fen = root.get("m", "").strip()
    board, side = x.parse_fen(fen)
    main = []
    for ch in root.findall("n"):
        node, _, _ = node_to_dict(ch, [r[:] for r in board], side)
        main.append(node)
    result = {"fen": fen, "win": root.get("win", "*")}
    if main:
        result["moves"] = main
    return result


def count_nodes(node):
    n = 1
    for ch in node.get("ch", []):
        n += count_nodes(ch)
    return n


def count_variations(node):
    chs = node.get("ch", [])
    n = max(0, len(chs) - 1)
    for ch in chs:
        n += count_variations(ch)
    return n


def count_comments(node):
    n = 1 if node.get("c") else 0
    for ch in node.get("ch", []):
        n += count_comments(ch)
    return n


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    stats = {"ok": 0, "fail": 0, "skipped": 0}
    failures = []
    index = {"categories": []}

    with zipfile.ZipFile(ZIP_PATH) as z:
        infos = [i for i in z.infolist() if i.filename.lower().endswith(".pfc")]
        # 按（目录，文件名）排序
        infos.sort(key=lambda i: decode_name(i.filename))
        cats = {}
        for info in infos:
            name = decode_name(info.filename)
            parts = name.split("/")
            if len(parts) < 3:
                stats["skipped"] += 1
                continue
            cat_dir = parts[1].strip()          # 如 "A 基本杀法"
            title = os.path.splitext(parts[-1])[0].strip()
            m = re.match(r"^([A-Z])\s*(.*)$", cat_dir)
            if not m:
                stats["skipped"] += 1
                continue
            cat_id, cat_name = m.group(1), m.group(2).strip()

            raw = z.read(info).decode("utf-8-sig", errors="replace")
            try:
                data = convert(raw)
            except Exception as e:
                stats["fail"] += 1
                failures.append("%s | %s" % (name, e))
                continue

            lessons = cats.setdefault(cat_id, {"id": cat_id, "name": cat_name, "lessons": []})
            seq = len(lessons["lessons"]) + 1
            rel = "%s/%03d.json" % (cat_id, seq)
            data["title"] = title
            data["category"] = cat_id
            data["file"] = rel
            data["plies"] = sum(count_nodes(n2) for n2 in data.get("moves", []))
            data["vars"] = sum(count_variations(n2) for n2 in data.get("moves", []))
            data["annotated"] = any(count_comments(n2) for n2 in data.get("moves", []))

            out_path = os.path.join(OUT_DIR, cat_id)
            os.makedirs(out_path, exist_ok=True)
            with open(os.path.join(out_path, "%03d.json" % seq), "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, separators=(",", ":"))

            lessons["lessons"].append({
                "id": "%s%03d" % (cat_id, seq),
                "title": title,
                "file": "data/lessons/" + rel,
                "plies": data["plies"],
                "vars": data["vars"],
                "annotated": data["annotated"],
            })
            stats["ok"] += 1

    for cat_id in sorted(cats):
        index["categories"].append(cats[cat_id])

    with open(os.path.join(ROOT, "data", "index.json"), "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, separators=(",", ":"))

    print(json.dumps(stats, ensure_ascii=False))
    for cat in index["categories"]:
        print("  %s %s: %d 课" % (cat["id"], cat["name"], len(cat["lessons"])))
    if failures:
        print("\n%d 个失败样例:" % len(failures))
        for line in failures[:15]:
            print("  " + line)
        fail_path = os.path.join(HERE, "build_failures.log")
        with open(fail_path, "w", encoding="utf-8") as f:
            f.write("\n".join(failures))
        print("完整清单: " + fail_path)


if __name__ == "__main__":
    main()
