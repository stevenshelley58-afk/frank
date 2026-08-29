from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[3]
APP = ROOT / "apps" / "window"


class InfraContractTest(unittest.TestCase):
    def test_window_image_copies_all_imported_runtime_modules(self):
        dockerfile = (APP / "Dockerfile").read_text(encoding="utf-8")
        self.assertIn("COPY connections_agent.py .", dockerfile)
        self.assertIn("COPY mini_frank.py .", dockerfile)
        self.assertIn("COPY tool_apps ./tool_apps", dockerfile)
        self.assertIn("COPY tools ./tools", dockerfile)
        deploy = (APP / "deploy.sh").read_text(encoding="utf-8")
        self.assertIn('"import connections_agent, home_platform, server, tool_apps;', deploy)
        self.assertIn("import memory_inspector, mini_frank", deploy)

    def test_caddy_receives_only_derived_basic_auth_env(self):
        compose = (APP / "docker-compose.yml").read_text(encoding="utf-8")
        caddy = compose.split("  frank-caddy:", 1)[1].split("\n  volumes:", 1)[0]
        self.assertIn("FRANK_CADDY_ENV_FILE", caddy)
        self.assertNotIn("FRANK_WINDOW_ENV_FILE", caddy)
        self.assertNotIn("HERMES_CONNECTIONS_AGENT_KEY", caddy)
        self.assertNotIn("HERMES_VAULT_BROKER_KEY", caddy)
        self.assertNotIn("HERMES_API_KEY", caddy)
        caddyfile = (APP / "Caddyfile").read_text(encoding="utf-8")
        self.assertIn("header_up -X-Frank-Operator-Attestation", caddyfile)
        self.assertIn("header_up X-Frank-Operator-Attestation {$FRANK_BASIC_AUTH_HASH}", caddyfile)
        self.assertIn("request>headers>X-Frank-Operator-Attestation delete", caddyfile)
        self.assertIn("request>headers>X-Mini-Claim delete", caddyfile)

    def test_mini_routes_are_public_without_exposing_operator_attestation(self):
        caddyfile = (APP / "Caddyfile").read_text(encoding="utf-8")
        mini_api = caddyfile.index("@mini_api path /api/mini /api/mini/*")
        frank_ui = caddyfile.index("@frank_ui path /frank /frank/*")
        legacy_mini = caddyfile.index("@mini_legacy path /mini /mini/*")
        fallback = caddyfile.index("        handle {\n            import frank_private_response_headers", legacy_mini)
        basic_auth = caddyfile.index("basic_auth")
        self.assertLess(mini_api, basic_auth)
        self.assertLess(frank_ui, basic_auth)
        public_routes = caddyfile[mini_api:basic_auth]
        mini_api_route = caddyfile[mini_api:frank_ui]
        frank_ui_route = caddyfile[frank_ui:legacy_mini]
        api_policy = caddyfile.split("(frank_mini_api_response_headers) {", 1)[1].split("}", 2)[0]
        ui_policy = caddyfile.split("(frank_mini_ui_response_headers) {", 1)[1].split("}", 2)[0]
        self.assertNotIn("{$FRANK_BASIC_AUTH_HASH}", public_routes)
        self.assertIn("header_up -X-Frank-Operator-Attestation", public_routes)
        self.assertIn("import frank_mini_api_response_headers", mini_api_route)
        self.assertIn("import frank_mini_ui_response_headers", frank_ui_route)
        self.assertNotIn("frank_private_response_headers", mini_api_route)
        self.assertNotIn("frank_private_response_headers", frank_ui_route)
        self.assertIn('Cache-Control "no-store"', api_policy)
        self.assertIn('X-Robots-Tag "noindex, nofollow, noarchive, nosnippet"', api_policy)
        self.assertIn('Cache-Control "public, no-cache"', ui_policy)
        self.assertIn("max_size 56MB", mini_api_route)
        self.assertIn('X-Robots-Tag "index, follow"', ui_policy)
        self.assertIn("script-src 'self'; style-src 'self';", ui_policy)
        self.assertIn("frame-src 'self' https://preview.frank.fail", ui_policy)
        self.assertIn("frame-ancestors 'self'", ui_policy)
        self.assertNotIn("defer", ui_policy)

    def test_mini_project_site_is_project_owned_and_keeps_frank_shell_separate(self):
        caddyfile = (APP / "Caddyfile").read_text(encoding="utf-8")
        compose = (APP / "docker-compose.yml").read_text(encoding="utf-8")
        project_site = caddyfile.split("@mini_project_root", 1)[1].split("@frank_ui", 1)[0]
        caddy = compose.split("  frank-caddy:", 1)[1].split("\n  volumes:", 1)[0]

        self.assertIn("path /mini-frank", project_site)
        self.assertIn("handle_path /mini-frank/*", project_site)
        self.assertIn("root * /srv/mini-frank-site", project_site)
        self.assertIn("import frank_mini_ui_response_headers", project_site)
        self.assertNotIn("reverse_proxy", project_site)
        self.assertIn("/projects/mini-frank/site:/srv/mini-frank-site:ro", caddy)

    def test_private_response_policy_is_scoped_to_pavone_and_authenticated_frank(self):
        caddyfile = (APP / "Caddyfile").read_text(encoding="utf-8")
        self.assertIn("import frank_common_security_headers", caddyfile)
        self.assertEqual(caddyfile.count("import frank_private_response_headers"), 3)
        fallback = caddyfile[caddyfile.index("        handle {\n            import frank_private_response_headers"):]
        self.assertLess(fallback.index("import frank_private_response_headers"), fallback.index("basic_auth"))

    def test_template_release_bypass_is_exact_and_strips_private_headers(self):
        caddyfile = (APP / "Caddyfile").read_text(encoding="utf-8")
        release = caddyfile.split("@ad_template_release", 1)[1].split("@pavone_root", 1)[0]
        self.assertIn("method GET HEAD", release)
        self.assertIn("path_regexp ad_template_release ^/releases/ad-template-generator/", release)
        self.assertNotIn("basic_auth", release)
        self.assertIn("header_up -Authorization", release)
        self.assertIn("header_up -Cookie", release)
        self.assertIn("header_up -X-Frank-Operator-Attestation", release)
        self.assertIn("header_down -Set-Cookie", release)
        self.assertIn('-Cache-Control', release)
        self.assertIn('Cache-Control "public, max-age=300"', release)
        self.assertIn('-Cross-Origin-Resource-Policy', release)
        self.assertIn('Cross-Origin-Resource-Policy "cross-origin"', release)
        self.assertLess(caddyfile.index("@ad_template_release"), caddyfile.index("basic_auth"))

    def test_template_release_root_uses_existing_data_volume_and_hermes_ownership(self):
        deploy = (APP / "deploy.sh").read_text(encoding="utf-8")
        compose = (APP / "docker-compose.yml").read_text(encoding="utf-8")
        self.assertIn('template_release_dir="$data_dir/releases/ad-template-generator"', deploy)
        self.assertIn('install -d -o hermes -g hermes -m 0755 -- "$template_release_dir"', deploy)
        self.assertIn("/srv/frank/data/window:/data", compose)
        self.assertNotIn("template-release", compose)

    def test_deploy_recreates_caddy_so_bound_config_uses_current_revision(self):
        deploy = (APP / "deploy.sh").read_text(encoding="utf-8")
        self.assertIn("docker rm -f frank-window frank-caddy frank-frank-caddy-1", deploy)

    def test_deploy_provisions_mini_runtime_contract(self):
        deploy = (APP / "deploy.sh").read_text(encoding="utf-8")
        compose = (APP / "docker-compose.yml").read_text(encoding="utf-8")
        self.assertIn('mini_preview_dir="$preview_dir/mini"', deploy)
        self.assertIn('mini_workspace_dir="$data_dir/mini-shared/workspaces"', deploy)
        self.assertIn('legacy_mini_project_dir="/projects/mini-frank/customer-projects"', deploy)
        self.assertIn('install -d -o root -g root -m 0755 -- "$mini_preview_dir"', deploy)
        self.assertIn(
            'install -d -o root -g hermes -m 2750 -- "$data_dir/mini-shared" "$mini_workspace_dir"',
            deploy,
        )
        self.assertIn(
            'install -d -o hermes -g hermes -m 0750 -- "$legacy_mini_project_dir"',
            deploy,
        )
        window = compose.split("  frank-window:", 1)[1].split("\n  frank-caddy:", 1)[0]
        caddy = compose.split("  frank-caddy:", 1)[1].split("\n  volumes:", 1)[0]
        self.assertIn("/srv/frank/previews/mini:/previews/mini", window)
        self.assertIn("/projects/mini-frank/customer-projects:/legacy-mini-projects", window)
        self.assertIn("/srv/frank/data/window:/data", window)
        self.assertIn("/projects:/vps/projects:ro", window)
        self.assertNotIn("/projects:/vps/projects:rw", window)
        self.assertIn("/srv/frank/previews:/srv/frank/previews:ro", caddy)
        self.assertNotIn("mini-shared/workspaces", caddy)
        self.assertIn("secrets.token_urlsafe(48)", deploy)
        self.assertIn("if ! grep -q -E '^MINI_RATE_LIMIT_KEY=[^[:space:]]'", deploy)
        self.assertIn("^[A-Za-z0-9_-]{43,}$", deploy)
        self.assertIn("must be a URL-safe secret of at least 43 characters", deploy)
        self.assertIn('chmod 0600 "$tmp"', deploy)
        self.assertIn("frank-mini-builder:mini-v1", deploy)
        self.assertIn("infra/mini_builder/Dockerfile", deploy)
        self.assertIn("docker compose config --quiet", deploy)
        self.assertIn("caddy validate --config /etc/caddy/Caddyfile", deploy)
        self.assertIn("https://frank.fail/frank/", deploy)

        builder = (APP / "infra" / "mini_builder" / "Dockerfile").read_text(encoding="utf-8")
        self.assertIn("@sha256:", builder)
        self.assertIn("chromium", builder)
        for capability in ("libreoffice-calc", "libreoffice-writer", "openpyxl", "python-docx", "reportlab"):
            self.assertIn(capability, builder)

    def test_customer_preview_host_serves_only_franks_trusted_projection(self):
        caddyfile = (APP / "Caddyfile").read_text(encoding="utf-8")
        preview = caddyfile.split("preview.frank.fail {", 1)[1].split("tasks.frank.fail {", 1)[0]
        self.assertIn("Frank publishes validated, regular, non-symlink snapshots here", preview)
        self.assertIn("root * /srv/frank/previews", preview)
        self.assertIn("try_files {path} {path}/index.html =404", preview)
        self.assertIn("@mini_hidden path_regexp", preview)
        self.assertNotIn("mini-shared", preview)
        self.assertNotIn("rewrite", preview)

    def test_blockwise_product_uses_a_persistent_isolated_edge_attachment(self):
        compose = (APP / "docker-compose.yml").read_text(encoding="utf-8")
        caddyfile = (APP / "Caddyfile").read_text(encoding="utf-8")
        caddy = compose.split("  frank-caddy:", 1)[1].split("\nvolumes:", 1)[0]
        window = compose.split("  frank-window:", 1)[1].split("\n  frank-caddy:", 1)[0]
        product = caddyfile.split("blockwise.sale {", 1)[1].split("preview.frank.fail {", 1)[0]

        self.assertIn("- blockwise-product", caddy)
        self.assertNotIn("- blockwise-product", window)
        self.assertIn("blockwise-product:\n    external: true\n    name: blockwise-product", compose)
        self.assertIn("reverse_proxy product-caddy:80", product)
        self.assertIn("header_up X-Forwarded-Proto https", product)
        self.assertIn("max_size 14MB", product)
        self.assertIn("request>headers>Authorization delete", product)
        self.assertIn("request>headers>Cookie delete", product)
        self.assertNotIn("basic_auth", product)

    def test_customer_previews_are_not_indexed_or_content_sniffed(self):
        caddyfile = (APP / "Caddyfile").read_text(encoding="utf-8")
        preview = caddyfile.split("preview.frank.fail {", 1)[1].split("tasks.frank.fail {", 1)[0]
        self.assertIn('X-Content-Type-Options "nosniff"', preview)
        self.assertIn('Referrer-Policy "no-referrer"', preview)
        self.assertIn('Cross-Origin-Resource-Policy "cross-origin"', preview)
        self.assertIn("connect-src 'none'", preview)
        self.assertIn("form-action 'none'", preview)
        self.assertIn("object-src 'none'", preview)
        self.assertIn("sandbox allow-same-origin allow-downloads", preview)
        self.assertIn("script-src 'none'", preview)
        self.assertNotIn("allow-scripts", preview)
        self.assertNotIn("allow-top-navigation", preview)
        self.assertNotIn("allow-popups", preview)
        self.assertIn("frame-ancestors https://frank.fail", preview)
        self.assertIn('X-Robots-Tag "noindex, nofollow, noarchive, nosnippet"', preview)

    def test_customer_downloads_are_forced_to_download(self):
        caddyfile = (APP / "Caddyfile").read_text(encoding="utf-8")
        preview = caddyfile.split("preview.frank.fail {", 1)[1].split("tasks.frank.fail {", 1)[0]
        self.assertIn("handle @mini_download {", preview)
        self.assertIn('header Content-Disposition "attachment"', preview)
        self.assertIn("try_files {path} =404", preview)

    def test_release_runbook_orders_private_dependencies_before_frank(self):
        runbook = (ROOT / "docs" / "FRANK_RELEASE_RUNBOOK.md").read_text(encoding="utf-8")
        order = [
            "Validate `/srv/frank/secrets/window.env`",
            "Start and private-canary Infisical",
            "Bootstrap Hermes config and credentials",
            "Deploy the Hermes Connections Agent and broker",
            "Verify private ports `18082`, `18083`, and `18080`",
            "Deploy Frank",
            "Run the end-to-end private canary",
        ]
        positions = [runbook.index(item) for item in order]
        self.assertEqual(positions, sorted(positions))
        self.assertIn("rollback", runbook.lower())
        self.assertIn("chat data", runbook.lower())
        self.assertIn("non-symlink", runbook)

    def test_deploy_keeps_unconfigured_hermes_extensions_fail_closed(self):
        deploy = (APP / "deploy.sh").read_text(encoding="utf-8")
        required = deploy.split("# Validate the core Window boundary", 1)[1].split("done", 1)[0]
        self.assertIn("HERMES_API_KEY FRANK_BASIC_AUTH_USER FRANK_BASIC_AUTH_HASH", required)
        self.assertNotIn("HERMES_CONNECTIONS_AGENT_KEY", required)
        self.assertNotIn("HERMES_VAULT_BROKER_KEY", required)
        self.assertIn("Connections Agent ingress is not configured", deploy)
        self.assertIn("vault/provider status remains setup_needed", deploy)
        self.assertIn("never invent a key or broker URL", deploy)

    def test_deploy_grants_only_hermes_group_project_provisioning(self):
        deploy = (APP / "deploy.sh").read_text(encoding="utf-8")
        self.assertIn("install -d -o root -g hermes -m 2775 -- /projects", deploy)
        self.assertIn("Hermes user is required for project workspace provisioning", deploy)
