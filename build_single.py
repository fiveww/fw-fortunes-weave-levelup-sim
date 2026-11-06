#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""build_single.py — 把 web_sim 合并成单文件 HTML(手机 file:// 直开用)
所有 <script src> 内联;Worker 走 worker.js 自序列化的 Blob 路径(单文件旁无 worker.js,
makeWorker 直连失败自动落到 Blob,与桌面多文件行为一致)。
运行:python build_single.py → 同目录 few_sim_single.html
"""
import re, os

SRC = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(SRC, "few_sim_single.html")

def main():
    html = open(os.path.join(SRC, "index.html"), encoding="utf-8").read()
    def inline(m):
        name = m.group(1)
        code = open(os.path.join(SRC, name), encoding="utf-8").read()
        if "</script" in code.lower():
            raise SystemExit(f"{name} 内含 </script>,内联会截断,需先拆写")
        return "<script>\n" + code + "\n</script>"
    out, n = re.subn(r'<script src="([^"]+)"></script>', inline, html)
    assert n == 5, f"预期内联 5 个脚本,实际 {n}"
    open(OUT, "w", encoding="utf-8").write(out)
    print(f"OK {OUT}({len(out)//1024} KB,内联 {n} 脚本)")

if __name__ == "__main__":
    main()
