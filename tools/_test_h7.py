# -*- coding: utf-8 -*-
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "tools"))
import xiangqi as x

FEN = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1"
board, side = x.parse_fen(FEN)

def play(cns_seq):
    """play by coordinate text like h2e2, alternating from current side global."""
    global side
    for t in cns_seq:
        mv = x.parse_move(t)
        assert x.is_legal(board, side, mv), "illegal %s at %s" % (t, x.board_to_fen(board, side))
        x.apply_move(board, *mv)
        side = x.other(side)
        print("%s -> %s | %s" % (t, x.chinese_move(board, x.other(side), mv) if False else t, x.board_to_fen(board, side)))

# sequence: 兵七进一 炮2平3 炮二平五 象3进5 马二进三 卒3进1 车一平二
play(["c3c4", "b7c7", "h2e2", "c9e7", "h0g2", "c6c5", "i0h0"])
print("side to move:", side)
print("h7 attacked by red?", x.attacked_by(board, 7, 7, "r"))
print("h7 piece:", board[7][7])
print("h-file:", [(r, board[r][7]) for r in range(10)])
# black replies to check: is 车9平8 legal (i9h9)?
print("i9:", board[9][8], "h9:", board[9][7])
mv = x.parse_move("i9h9")
print("车9平8 legal?", x.is_legal(board, "b", mv))
mv = x.parse_move("h7i7")
print("炮8平9 legal?", x.is_legal(board, "b", mv))
