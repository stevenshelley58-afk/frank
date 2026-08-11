from __future__ import annotations

import importlib.util
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


SCRIPT = Path(__file__).parents[1] / "scripts" / "verify_scratch_runtime.py"
SPEC = importlib.util.spec_from_file_location("verify_scratch_runtime", SCRIPT)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("could not load scratch runtime verifier")
VERIFIER = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = VERIFIER
SPEC.loader.exec_module(VERIFIER)

POLICY_SCRIPT = Path(__file__).parents[1] / "runtime" / "sitecustomize.py"
POLICY_SPEC = importlib.util.spec_from_file_location("codegraph_runtime_sitecustomize", POLICY_SCRIPT)
if POLICY_SPEC is None or POLICY_SPEC.loader is None:
    raise RuntimeError("could not load scratch runtime import policy")
IMPORT_POLICY = importlib.util.module_from_spec(POLICY_SPEC)
sys.modules[POLICY_SPEC.name] = IMPORT_POLICY
POLICY_SPEC.loader.exec_module(IMPORT_POLICY)


class TkImportStaticCheckTests(unittest.TestCase):
    def test_runtime_sitecustomize_enforces_safe_fixed_roots(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            app = root / "app"
            site_packages = root / "site-packages"
            outside = root / "outside"
            projects = root / "repositories"
            for path in (app, site_packages, outside, projects):
                path.mkdir()
            environment = {
                "PYTHONPATH": IMPORT_POLICY.TRUSTED_PYTHONPATH,
                "PYTHONSAFEPATH": "1",
                "PYTHONNOUSERSITE": "1",
            }

            IMPORT_POLICY.validate_import_environment(
                environment=environment,
                path_entries=(str(app), str(site_packages)),
                safe_path=True,
                no_user_site=True,
                cwd=outside,
                validate_modules=False,
                trusted_roots=(app, site_packages),
                projects_root=projects,
            )
            with self.assertRaisesRegex(RuntimeError, "repository path"):
                IMPORT_POLICY.validate_import_environment(
                    environment=environment,
                    path_entries=(str(app), str(site_packages), str(projects / "project")),
                    safe_path=True,
                    no_user_site=True,
                    cwd=outside,
                    validate_modules=False,
                    trusted_roots=(app, site_packages),
                    projects_root=projects,
                )

    def test_trusted_pythonpath_contract_is_exact(self) -> None:
        trusted = "/app:/opt/frank-codegraph/site-packages"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            app = root / "app"
            site_packages = root / "site-packages"
            stdlib = root / "stdlib"
            outside = root / "tmp"
            repositories = root / "repositories"
            for path in (app, site_packages, stdlib, outside, repositories):
                path.mkdir()
            environment = {
                "PYTHONPATH": trusted,
                "PYTHONSAFEPATH": "1",
                "PYTHONNOUSERSITE": "1",
            }
            entries = (str(app), str(site_packages), str(stdlib))
            with mock.patch.dict(os.environ, environment, clear=True):
                VERIFIER.assert_trusted_pythonpath(
                    path_entries=entries,
                    safe_path=True,
                    no_user_site=True,
                    cwd=outside,
                    trusted_roots=(app, site_packages),
                    repositories_root=repositories,
                )
        self.assertEqual(VERIFIER.TRUSTED_PYTHONPATH, trusted)

    def test_safe_path_contract_rejects_empty_cwd_and_repository_entries(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            app = root / "app"
            site_packages = root / "site-packages"
            outside = root / "outside"
            repository = root / "repositories/project"
            for path in (app, site_packages, outside, repository):
                path.mkdir(parents=True)
            environment = {
                "PYTHONPATH": VERIFIER.TRUSTED_PYTHONPATH,
                "PYTHONSAFEPATH": "1",
                "PYTHONNOUSERSITE": "1",
            }
            cases = (
                ((str(app), str(site_packages), ""), "empty"),
                ((str(app), str(site_packages), str(outside)), "working directory"),
                ((str(app), str(site_packages), str(repository)), "repository path"),
            )
            with mock.patch.dict(os.environ, environment, clear=True):
                for entries, error in cases:
                    with self.subTest(error=error), self.assertRaisesRegex(RuntimeError, error):
                        VERIFIER.assert_trusted_pythonpath(
                            path_entries=entries,
                            safe_path=True,
                            no_user_site=True,
                            cwd=outside,
                            trusted_roots=(app, site_packages),
                            repositories_root=root / "repositories",
                        )

    def test_imports_trusted_package_from_non_app_working_directory(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            app = root / "app"
            outside = root / "outside"
            package = app / "verifier_probe_package"
            package.mkdir(parents=True)
            outside.mkdir()
            (package / "__init__.py").write_text("VALUE = 'trusted'\n", encoding="utf-8")
            original_cwd = Path.cwd()
            try:
                os.chdir(outside)
                with mock.patch.object(sys, "path", [str(app), *sys.path]):
                    module = VERIFIER.import_module_from_root("verifier_probe_package", app)
                self.assertEqual(module.VALUE, "trusted")
                self.assertEqual(Path.cwd(), outside)
            finally:
                sys.modules.pop("verifier_probe_package", None)
                os.chdir(original_cwd)

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
