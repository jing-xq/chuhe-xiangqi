# -*- coding: utf-8 -*-
"""中国象棋规则引擎：FEN 解析、走法生成、合法性判断、中文着法生成。

坐标约定：file 0-8 对应 a-i（红方视角从左到右），rank 0-9 从红方底线到黑方底线。
与鹏飞 .pfc 的 FEN/着法（如 h2e2）完全兼容。
"""

FILES = "abcdefghi"

# 棋子定义：side ('r' 红 / 'b' 黑), 类别
RED, BLACK = "r", "b"


def other(side):
    return BLACK if side == RED else RED


def parse_fen(fen):
    """返回 (board, side)。board[rank][file] = 棋子字符（大写红方/小写黑方），空格为 None。"""
    parts = fen.split()
    rows = parts[0].split("/")
    if len(rows) != 10:
        raise ValueError("FEN 必须 10 行: %s" % fen)
    board = [None] * 10
    for idx, row in enumerate(rows):
        rank = 9 - idx  # FEN 首行是黑方底线（rank 9），末行是红方底线（rank 0）
        rank_row = []
        for ch in row:
            if ch.isdigit():
                rank_row.extend([None] * int(ch))
            else:
                rank_row.append(ch)
        if len(rank_row) != 9:
            raise ValueError("FEN 行必须 9 列: %s" % row)
        board[rank] = rank_row
    side = RED if parts[1] == "w" else BLACK
    return board, side


def board_to_fen(board, side):
    rows = []
    for rank in range(9, -1, -1):
        row = ""
        empty = 0
        for p in board[rank]:
            if p is None:
                empty += 1
            else:
                if empty:
                    row += str(empty)
                    empty = 0
                row += p
        if empty:
            row += str(empty)
        rows.append(row)
    return "/".join(rows) + (" w - - 0 1" if side == RED else " b - - 0 1")


def in_board(f, r):
    return 0 <= f <= 8 and 0 <= r <= 9


def in_palace(f, r, side):
    if not (3 <= f <= 5):
        return False
    return 0 <= r <= 2 if side == RED else 7 <= r <= 9


def crossed_river(side, r):
    """该棋子（属于 side）是否已过河。"""
    return r >= 5 if side == RED else r <= 4


def find_king(board, side):
    k = "K" if side == RED else "k"
    for r in range(10):
        for f in range(9):
            if board[r][f] == k:
                return f, r
    return None


def kings_face(board):
    """两将帅照面（之间无子）。"""
    rk = find_king(board, RED)
    bk = find_king(board, BLACK)
    if not rk or not bk or rk[0] != bk[0]:
        return False
    f = rk[0]
    lo, hi = sorted([rk[1], bk[1]])
    for r in range(lo + 1, hi):
        if board[r][f] is not None:
            return False
    return True


def attacked_by(board, tf, tr, side):
    """(tf,tr) 是否被 side 方的棋子攻击。"""
    # 马
    for df, dr in [(-1, -2), (1, -2), (-2, -1), (2, -1),
                   (-2, 1), (2, 1), (-1, 2), (1, 2)]:
        f, r = tf + df, tr + dr  # 马的位置
        if in_board(f, r):
            p = board[r][f]
            if p and p.lower() == "n" and (p.isupper() == (side == RED)):
                # 马腿：长轴方向上靠马一格的正交点
                if abs(df) == 2:
                    lf = f - (1 if df > 0 else -1)
                    leg_free = board[r][lf] is None
                else:
                    lr = r - (1 if dr > 0 else -1)
                    leg_free = board[lr][f] is None
                if leg_free:
                    return True
    # 车、炮（直线）与兵、将（单步）
    for df, dr in [(0, 1), (0, -1), (1, 0), (-1, 0)]:
        f, r = tf + df, tr + dr
        blocked = 0
        while in_board(f, r):
            p = board[r][f]
            if p is not None:
                mine = p.isupper() == (side == RED)
                if mine:
                    lp = p.lower()
                    if blocked == 0 and lp == "r":
                        return True
                    if blocked == 1 and lp == "c":
                        return True
                    if blocked == 0 and lp == "k" and abs(f - tf) + abs(r - tr) == 1:
                        return True
                    if blocked == 0 and lp == "p":
                        ps = RED if p.isupper() else BLACK
                        forward = 1 if ps == RED else -1
                        if f == tf and r == tr - forward:  # 兵向前
                            return True
                        if crossed_river(ps, r) and r == tr and abs(f - tf) == 1:
                            return True
                blocked += 1
                if blocked > 1:
                    break
            f += df
            r += dr
    # 士、象的攻击（不可能攻击将帅区外目标，但帅在九宫，士象可及）
    for df, dr in [(-1, -1), (1, -1), (-1, 1), (1, 1)]:
        f, r = tf + df, tr + dr
        if in_board(f, r):
            p = board[r][f]
            if p and p.lower() == "a" and (p.isupper() == (side == RED)) and in_palace(f, r, side):
                return True
    for df, dr in [(-2, -2), (2, -2), (-2, 2), (2, 2)]:
        f, r = tf + df, tr + dr
        if in_board(f, r):
            p = board[r][f]
            if p and p.lower() == "b" and (p.isupper() == (side == RED)):
                if board[(tr + r) // 2][(tf + f) // 2] is None:
                    # 象不过河
                    if (side == RED and r <= 4) or (side == BLACK and r >= 5):
                        return True
    return False


def pseudo_moves(board, side):
    """生成 side 方全部伪合法走法，返回 [(f0,r0,f1,r1)]。"""
    moves = []
    for r in range(10):
        for f in range(9):
            p = board[r][f]
            if p is None or (p.isupper() != (side == RED)):
                continue
            lp = p.lower()
            if lp == "k":
                for df, dr in [(0, 1), (0, -1), (1, 0), (-1, 0)]:
                    nf, nr = f + df, r + dr
                    if in_palace(nf, nr, side):
                        moves.append((f, r, nf, nr))
            elif lp == "a":
                for df, dr in [(-1, -1), (1, -1), (-1, 1), (1, 1)]:
                    nf, nr = f + df, r + dr
                    if in_palace(nf, nr, side):
                        moves.append((f, r, nf, nr))
            elif lp == "b":
                for df, dr in [(-2, -2), (2, -2), (-2, 2), (2, 2)]:
                    nf, nr = f + df, r + dr
                    if not in_board(nf, nr):
                        continue
                    if side == RED and nr > 4:
                        continue
                    if side == BLACK and nr < 5:
                        continue
                    if board[(r + nr) // 2][(f + nf) // 2] is None:
                        moves.append((f, r, nf, nr))
            elif lp == "n":
                for df, dr, ef, er in [(-1, -2, 0, -1), (1, -2, 0, -1), (-2, -1, -1, 0),
                                       (2, -1, 1, 0), (-2, 1, -1, 0), (2, 1, 1, 0),
                                       (-1, 2, 0, 1), (1, 2, 0, 1)]:
                    nf, nr = f + df, r + dr
                    if not in_board(nf, nr):
                        continue
                    if board[r + er][f + ef] is not None:
                        continue
                    moves.append((f, r, nf, nr))
            elif lp in ("r", "c"):
                for df, dr in [(0, 1), (0, -1), (1, 0), (-1, 0)]:
                    nf, nr = f + df, r + dr
                    jumped = False
                    while in_board(nf, nr):
                        t = board[nr][nf]
                        if not jumped:
                            if t is None:
                                moves.append((f, r, nf, nr))
                            elif lp == "r":
                                if t.isupper() != (side == RED):
                                    moves.append((f, r, nf, nr))
                                break
                            else:  # 炮：跳过一个子后可吃
                                jumped = True
                        else:
                            if t is not None:
                                if t.isupper() != (side == RED):
                                    moves.append((f, r, nf, nr))
                                break
                        nf += df
                        nr += dr
            elif lp == "p":
                forward = 1 if side == RED else -1
                if in_board(f, r + forward):
                    moves.append((f, r, f, r + forward))
                if crossed_river(side, r):
                    for df in (-1, 1):
                        if in_board(f + df, r):
                            moves.append((f, r, f + df, r))
    return moves


def apply_move(board, f0, r0, f1, r1):
    """原位修改并返回被吃棋子。"""
    captured = board[r1][f1]
    board[r1][f1] = board[r0][f0]
    board[r0][f0] = None
    return captured


def is_legal(board, side, mv):
    """判断走法是否合法（走后己方不被将军、不照面）。"""
    f0, r0, f1, r1 = mv
    if not in_board(f0, r0) or not in_board(f1, r1):
        return False
    p = board[r0][f0]
    if p is None or (p.isupper() != (side == RED)):
        return False
    if board[r1][f1] is not None and board[r1][f1].isupper() == (side == RED):
        return False
    if mv not in pseudo_moves(board, side):
        return False
    captured = apply_move(board, f0, r0, f1, r1)
    k = find_king(board, side)
    ok = k is not None and not attacked_by(board, k[0], k[1], other(side)) and not kings_face(board)
    # 撤销
    board[r0][f0] = board[r1][f1]
    board[r1][f1] = captured
    return ok


def legal_moves(board, side):
    return [mv for mv in pseudo_moves(board, side) if is_legal(board, side, mv)]


def is_check(board, side):
    k = find_king(board, side)
    return k is not None and attacked_by(board, k[0], k[1], other(side))


def is_checkmate(board, side):
    return is_check(board, side) and not legal_moves(board, side)


def parse_move(text):
    """h2e2 -> (7,2,4,2)。鹏飞格式另有 h0h1 等；支持 a-i / 0-8 两种文件记法。"""
    text = text.strip().lower()
    if len(text) != 4:
        raise ValueError("着法长度须为 4: %s" % text)
    def c2f(c):
        if "a" <= c <= "i":
            return ord(c) - ord("a")
        if "0" <= c <= "8":
            return int(c)
        raise ValueError("非法文件字符: %s" % c)
    f0, r0 = c2f(text[0]), int(text[1])
    f1, r1 = c2f(text[2]), int(text[3])
    return f0, r0, f1, r1


def move_to_text(mv):
    return "%s%d%s%d" % (FILES[mv[0]], mv[1], FILES[mv[2]], mv[3])


# ---------- 中文着法 ----------

CN_NUM = "一二三四五六七八九"
AR_NUM = "１２３４５６７８９"

PIECE_CN = {"k": ("帅", "将"), "a": ("仕", "士"), "b": ("相", "象"),
            "n": ("马", "马"), "r": ("车", "车"), "c": ("炮", "炮"), "p": ("兵", "卒")}


def num_cn(side, n):
    """数字着法记谱：红方用中文数字，黑方用阿拉伯数字。"""
    return CN_NUM[n - 1] if side == RED else str(n)


def file_cn(side, f):
    """file 序号转记谱数字。红方从右往左数一-九（file8=一），黑方从左往右 1-9。"""
    return num_cn(side, 9 - f) if side == RED else num_cn(side, f + 1)


def chinese_move(board, side, mv):
    """根据走前棋盘生成中文着法，如 炮二平五 / 马8进7 / 前车进二。"""
    f0, r0, f1, r1 = mv
    p = board[r0][f0]
    lp = p.lower()
    name = PIECE_CN[lp][0 if side == RED else 1]

    # 同文件同名子（用于前/后区分）
    same = [(f, r) for r in range(10) for f in range(9)
            if board[r][f] is not None and board[r][f].lower() == lp
            and (board[r][f].isupper() == (side == RED)) and f == f0 and (f, r) != (f0, r0)]

    prefix = ""
    file_str = file_cn(side, f0)
    if same:
        # 前 = 更靠近对方（红方 rank 大、黑方 rank 小）
        if side == RED:
            front = all(r0 > r for f, r in same)
            behind = all(r0 < r for f, r in same)
        else:
            front = all(r0 < r for f, r in same)
            behind = all(r0 > r for f, r in same)
        if front:
            prefix, file_str = "前", ""
        elif behind:
            prefix, file_str = "后", ""

    if lp in ("k", "a", "b", "n"):
        # 斜走/单步：进/退 + 到达文件
        forward = (r1 > r0) if side == RED else (r1 < r0)
        verb = "进" if forward else "退"
        return "%s%s%s%s%s" % (prefix, name, file_str, verb, file_cn(side, f1))
    else:
        # 直走：进/退 + 步数，或 平 + 到达文件
        if r1 == r0:
            return "%s%s%s平%s" % (prefix, name, file_str, file_cn(side, f1))
        dist = abs(r1 - r0)
        forward = (r1 > r0) if side == RED else (r1 < r0)
        verb = "进" if forward else "退"
        return "%s%s%s%s%s" % (prefix, name, file_str, verb, num_cn(side, dist))
