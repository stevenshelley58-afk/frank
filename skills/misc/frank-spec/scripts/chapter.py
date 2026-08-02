#!/usr/bin/env python3
"""Extract one FRANK spec chapter by number (lazy-load, book-to-skill pattern).

Usage:  python3 chapter.py <N> [--max-chars 4000]
Reads the canonical spec and prints only chapter N (## N. ...) so an agent
loads ~100 lines instead of the full 3468-line spec. Default 4000-char cap
keeps the biggest chapters from flooding context; raise it when you need all.
"""
import re, sys, pathlib

SPEC = pathlib.Path(__file__).resolve().parents[4] / "docs" / "product" / "FRANK_COMPLETE_BUILD_PLAN_AND_SPEC.md"


def main() -> int:
    args = [a for a in sys.argv[1:] if a]
    if not args or args[0] in ("-h", "--help"):
        print(__doc__)
        return 0
    try:
        n = int(args[0])
    except ValueError:
        print(f"chapter number must be an int, got {args[0]!r}", file=sys.stderr)
        return 2
    max_chars = 4000
    if "--max-chars" in args:
        max_chars = int(args[args.index("--max-chars") + 1])
    lines = SPEC.read_text(encoding="utf-8").splitlines()
    starts = [(int(m.group(1)), i) for i, l in enumerate(lines)
              if (m := re.match(r"^## (\d+)\. ", l))]
    starts.append((None, len(lines)))
    for k, (num, s) in enumerate(starts[:-1]):
        if num == n:
            e = starts[k + 1][1]
            text = "\n".join(lines[s:e]).strip()
            if len(text) > max_chars:
                text = text[:max_chars] + (
                    f"\n\n[… truncated at {max_chars} chars of {len(text)}; "
                    f"rerun with --max-chars {len(text) + 100} for the rest]"
                )
            print(text)
            return 0
    avail = [num for num, _ in starts[:-1]]
    print(f"no chapter {n}; available: {avail}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
