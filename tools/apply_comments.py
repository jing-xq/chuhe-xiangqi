# -*- coding: utf-8 -*-
"""把评注文本合并进开局谱 JSON（只写 c / dev.why / dev.punish，绝不碰 m/ch 结构）。

用法：
    python tools/apply_comments.py                 # 应用 tools/_eng/<id>.comments.json → data/openings/<id>.json
    python tools/apply_comments.py --only cp-pfm
    python tools/apply_comments.py --check         # 只校验不写

comments.json 格式（每个体系一份）：
    {
      "c":    { "0/2/1": "评注文字……", ... },          # 节点路径 id → c 字段
      "devs": { "0/4":   {"why": "...", "punish": "..."} }  # 可选，润色脱谱讲解
    }
节点路径 id = 从根按下标走：moves[0]="0"，moves[0].ch[1]="0/1"。
"""
import sys
import json
import io
import os

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENG_DIR = os.path.join(ROOT, "tools", "_eng")
OPEN_DIR = os.path.join(ROOT, "data", "openings")

argv = sys.argv[1:]
ONLY = None
CHECK = "--check" in argv
if "--only" in argv:
    ONLY = argv[argv.index("--only") + 1]


def node_at(moves, path_id):
    """按下标路径取节点；失败返回 None。"""
    try:
        idxs = [int(x) for x in path_id.split("/")]
    except ValueError:
        return None
    nodes = moves
    node = None
    for i in idxs:
        if i < 0 or i >= len(nodes):
            return None
        node = nodes[i]
        nodes = node.get("ch", [])
    return node


def apply_one(sys_id):
    cpath = os.path.join(ENG_DIR, sys_id + ".comments.json")
    jpath = os.path.join(OPEN_DIR, sys_id + ".json")
    if not os.path.exists(cpath):
        print(u"[跳过] %s：无 %s.comments.json" % (sys_id, sys_id))
        return True
    with open(cpath, encoding="utf-8") as f:
        patch = json.load(f)
    with open(jpath, encoding="utf-8") as f:
        data = json.load(f)

    errors = []
    n_c = n_dev = 0
    for path_id, text in (patch.get("c") or {}).items():
        node = node_at(data.get("moves", []), path_id)
        if node is None:
            errors.append(u"c[%s]：路径不存在" % path_id)
            continue
        if not isinstance(text, str) or not text.strip():
            errors.append(u"c[%s]：空文本" % path_id)
            continue
        node["c"] = text.strip()
        n_c += 1
    for path_id, d in (patch.get("devs") or {}).items():
        node = node_at(data.get("moves", []), path_id)
        if node is None:
            errors.append(u"devs[%s]：路径不存在" % path_id)
            continue
        devs = node.get("dev")
        if not devs:
            errors.append(u"devs[%s]：该节点无 dev" % path_id)
            continue
        for key in ("why", "punish"):
            if d.get(key):
                devs[0][key] = d[key].strip()
                n_dev += 1

    if errors:
        for e in errors:
            print(u"[错误] %s: %s" % (sys_id, e))
        return False
    if CHECK:
        print(u"[检查] %s：c×%d dev润色×%d" % (sys_id, n_c, n_dev))
        return True
    with open(jpath, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print(u"[写回] %s：c×%d dev润色×%d" % (sys_id, n_c, n_dev))
    return True


def main():
    ids = []
    if ONLY:
        ids = [ONLY]
    else:
        for name in sorted(os.listdir(OPEN_DIR)):
            if name.endswith(".json") and name != "index.json":
                ids.append(name[:-5])
    ok = all([apply_one(i) for i in ids])   # 显式逐个执行
    if not ok:
        sys.exit(1)
    print(u"完成。下一步：python tools/build_openings.py && node tools/test_opening_logic.js")


if __name__ == "__main__":
    main()
