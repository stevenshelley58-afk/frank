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
    assert "'/frank/session'" in config
    assert "getUserIdentifier() === 'owner'" in controller
    assert "['authenticated' => $authenticated]" in controller
    assert "403" in controller

def test_mautic_main_route_does_not_duplicate_native_s_prefix():
    config = (ROOT / "native/mautic_frank_owner_entry/Config/config.php").read_text()
    assert "'/frank/session'" in config and "'/frank/return'" in config
    assert "'/s/frank" not in config
    assert "EntryController::sessionAction" in config

def test_frappe_app_has_installer_required_metadata_files():
    app = ROOT / "native/frappe_owner_entry/frank_owner_entry"
    assert (app / "modules.txt").is_file()
    assert (app / "patches.txt").is_file()

def test_mautic_provisioner_repairs_web_owned_cache_and_logs_before_clear():
    source = SCRIPT.read_text()
    assert "install -d -o www-data -g www-data" in source
    assert "chown -R www-data:www-data /var/www/html/var/cache /var/www/html/var/logs" in source
    assert "docker exec -u www-data" in source


def test_mautic_sp_entity_and_acs_are_both_the_native_marketing_origin():
    # LightSAML derives Mautic's only ACS from saml_idp_entity_id and rejects a
    # Response whose Destination or bearer Recipient is any other location, so
    # the SP entity ID, the Authentik audience and the Authentik ACS all sit on
    # the owner-gated marketing origin. site_url stays public.
    bootstrap = (ROOT / "bin/bootstrap.py").read_text()
    source = SCRIPT.read_text()
    example = (ROOT / ".env.example").read_text()
    assert '"https://mail.blockwise.sale"' not in bootstrap
    assert 'os.environ.get("OWNER_IDENTITY_MAUTIC_SP_ENTITY_ID", MARKETING_ORIGIN)' in bootstrap
    assert 'f"{MARKETING_ORIGIN}/s/saml/login_check"' in bootstrap
    assert 'OWNER_IDENTITY_MAUTIC_SP_ENTITY_ID must be the native marketing origin' in bootstrap
    assert 'OWNER_IDENTITY_MAUTIC_ACS_URL must be the native marketing SAML ACS' in bootstrap
    assert '[[ "$mautic_entity" == "$marketing_origin" ]]' in source
    assert 'MAUTIC_SAML_ACS_URL="$mautic_acs"' in source
    assert 'MAUTIC_SAML_SP_ENTITY_ID="$mautic_entity"' in source
    assert 'if saml[0].get("acs_url") != expected_acs' in source
    assert 'if saml[0].get("audience") != expected_audience' in source
    assert 'OWNER_IDENTITY_MAUTIC_SP_ENTITY_ID=https://marketing.frank.fail\n' in example
    assert 'OWNER_IDENTITY_MAUTIC_ACS_URL=https://marketing.frank.fail/s/saml/login_check' in example

def test_identity_adr_records_the_native_acs_without_a_public_saml_route():
    adr = (ROOT.parents[3] / "docs/OWNER_IDENTITY_ADR.md").read_text()
    assert 'no ACS override' in adr
    assert 'Destination' in adr and 'Recipient' in adr
    assert 'https://marketing.frank.fail/s/saml/login_check' in adr
    assert 'without adding any SAML route to it' in adr
