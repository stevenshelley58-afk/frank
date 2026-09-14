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
