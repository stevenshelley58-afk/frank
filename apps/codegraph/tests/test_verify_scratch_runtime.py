from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).parents[1] / "scripts" / "verify_scratch_runtime.py"
SPEC = importlib.util.spec_from_file_location("verify_scratch_runtime", SCRIPT)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("could not load scratch runtime verifier")
VERIFIER = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = VERIFIER
SPEC.loader.exec_module(VERIFIER)


class TkImportStaticCheckTests(unittest.TestCase):
    def test_accepts_non_gui_codegraph_call_path(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "module.py").write_text("import json\n", encoding="utf-8")
            VERIFIER.assert_no_tk_imports((root,))

    def test_rejects_direct_and_dynamic_tk_imports(self) -> None:
        snippets = (
            "import _tkinter\n",
            "from tkinter import Tcl\n",
            "import importlib\nimportlib.import_module('tkinter.ttk')\n",
            "__import__('_tkinter')\n",
        )
        for snippet in snippets:
            with self.subTest(snippet=snippet), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                (root / "module.py").write_text(snippet, encoding="utf-8")
                with self.assertRaisesRegex(RuntimeError, "Tk import is forbidden"):
                    VERIFIER.assert_no_tk_imports((root,))
