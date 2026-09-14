from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'bin' / 'provision-native.sh'

def test_shell_syntax_is_valid():
    subprocess.run(['bash', '-n', str(SCRIPT)], check=True)

def test_uses_native_sso_not_proxy_impersonation():
    source = SCRIPT.read_text()
    assert 'provision-frappe-console.py' in source
    assert '/application/saml/mautic/metadata/' in source
    assert 'saml_idp_metadata' in source
    assert '"saml_idp_default_role"=>""' in source
    assert 'X-Forwarded-User' not in source
    assert 'REMOTE_USER' not in source

def test_mautic_update_validates_and_preserves_other_parameters():
    source = SCRIPT.read_text()
    assert 'simplexml_load_string' in source
    assert 'array_replace($parameters,$w)' in source
    assert 'fileperms($path)' in source
    assert 'cache:clear' in source

def test_native_entry_packages_have_fixed_allowlisted_returns():
    native = ROOT / "native"
    frappe = (native / "frappe_owner_entry/frank_owner_entry/api.py").read_text()
    mautic = (native / "mautic_frank_owner_entry/Controller/EntryController.php").read_text()
    assert '"crm"' in frappe and '"support"' in frappe
    assert 'get_oauth2_authorize_url("authentik", target)' in frappe
    assert 'https://' not in frappe
    assert "campaigns&return=1" in mautic
    assert "Request" not in mautic

def test_mautic_session_proof_requires_exact_native_owner():
    controller = (ROOT / "native/mautic_frank_owner_entry/Controller/EntryController.php").read_text()
    config = (ROOT / "native/mautic_frank_owner_entry/Config/config.php").read_text()
    assert "/s/frank/session" in config
    assert "getUserIdentifier() === 'owner'" in controller
    assert "['authenticated' => $authenticated]" in controller
    assert "403" in controller
