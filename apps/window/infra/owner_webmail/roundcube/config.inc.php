<?php
/**
 * Owner webmail (Roundcube) configuration.
 *
 * Committed source, mounted read-only over the pinned upstream image's
 * config/config.inc.php. The image entrypoint rewrites the generated
 * config.docker.inc.php from ROUNDCUBEMAIL_* environment variables; including it
 * first and then assigning the owner values below means this file is the single
 * source of truth for mail, session and framing behaviour while the image keeps
 * owning the database DSN, temp directory and DES key bootstrapping.
 *
 * No credential appears in this file. The mailbox password is read from the
 * process environment, which comes from /srv/frank/secrets/owner-webmail.env.
 */

// The image entrypoint generates config.docker.inc.php from ROUNDCUBEMAIL_*
// environment variables and merges its plugin list into $config['plugins'].
// Roundcube loads this file with an empty $config, so the key it merges into
// has to exist before the include.
$config['plugins'] = [];

include __DIR__ . '/config.docker.inc.php';

$env = static function (string $name, string $default = ''): string {
    $value = getenv($name);
    return $value === false || $value === '' ? $default : trim((string) $value);
};

// ---------------------------------------------------------------------------
// Product identity and transport
// ---------------------------------------------------------------------------
$config['product_name'] = 'Owner Mail';
$config['skin'] = 'elastic';
$config['request_path'] = '/';
$config['support_url'] = '';
$config['display_product_info'] = 0;

$config['imap_host'] = $env('OWNER_WEBMAIL_IMAP_HOST');
$config['smtp_host'] = $env('OWNER_WEBMAIL_SMTP_HOST');
$config['smtp_user'] = '%u';
$config['smtp_pass'] = '%p';

// Submission must not add its own copy: Roundcube appends exactly one copy to
// the identity's Sent folder after a successful send.
$config['smtp_save_sent_messages'] = false;

// Provider certificates are verified; the mailbox is never reached in clear.
$tls = [
    'ssl' => [
        'verify_peer' => true,
        'verify_peer_name' => true,
        'allow_self_signed' => false,
    ],
];
$config['imap_conn_options'] = $tls;
$config['smtp_conn_options'] = $tls;

// Mailbox folders already exist on the provider and are used unchanged.
$config['sent_mbox'] = 'Sent';
$config['drafts_mbox'] = 'Drafts';
$config['trash_mbox'] = 'Trash';
$config['junk_mbox'] = 'Junk';
$config['archive_mbox'] = 'Archive';
$config['create_default_folders'] = false;

// ---------------------------------------------------------------------------
// Plugins
// ---------------------------------------------------------------------------
// frank_sso redeems the broker's one-use launch token through the stock
// 'authenticate' hook. managesieve is deliberately absent: the provider holds a
// load-bearing support-routing Sieve script and this client must not be the
// thing that rewrites it. See README.md.
$config['plugins'] = [
    'frank_sso',
    'archive',
    'zipdownload',
    'attachment_reminder',
    'hide_blockquote',
    'identity_select',
    'markasjunk',
    'new_user_identity',
    'show_additional_headers',
    'vcard_attachments',
];

// Identities come from the IMAP login, not from a guessed domain.
$config['new_user_identity_on_create'] = true;
$config['new_user_identity_string'] = '%n <%l@%d>';
$config['identity_select_sort_order'] = 'email';

// ---------------------------------------------------------------------------
// Session and framing
// ---------------------------------------------------------------------------
$config['session_lifetime'] = 60;
$config['session_samesite'] = $env('OWNER_WEBMAIL_COOKIE_SAMESITE', 'Lax');
$config['session_storage'] = 'db';
$config['login_lc'] = 0;
$config['ip_check'] = false;

// Roundcube only accepts X-Forwarded-* from these ranges. The webmail container
// is only ever reached through the compose ingress, so the private ranges are
// the whole of its reachable world.
$config['proxy_whitelist'] = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'];
// The ingress terminates the TLS that Caddy started, so Roundcube is told
// plainly that this deployment is HTTPS-only: the session cookie is issued
// Secure and plain HTTP is redirected.
$config['use_https'] = true;
$config['force_https'] = true;

$trusted_hosts = $env('OWNER_WEBMAIL_TRUSTED_HOSTS');
$config['trusted_host_patterns'] = $trusted_hosts === ''
    ? ['^mail\\.frank\\.fail$']
    : array_values(array_filter(array_map('trim', explode(',', $trusted_hosts))));

// The ingress owns the framing policy so exactly one approved parent origin can
// embed the panel; a blanket sameorigin header would fight it.
$config['x_frame_options'] = false;

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------
// Errors only, to stdout, and never a credential: Roundcube's logger records
// the IMAP/SMTP server response, not the password.
$config['log_driver'] = 'stdout';
$config['log_logins'] = false;
$config['per_user_logging'] = false;
$config['sql_debug'] = false;
$config['imap_debug'] = false;
$config['smtp_debug'] = false;

// ---------------------------------------------------------------------------
// HTML mail isolation and attachments
// ---------------------------------------------------------------------------
// washtml sanitises message HTML with an element/attribute allowlist, strips
// scripts and forms, and blocks remote content until the owner asks for it.
$config['prefer_html'] = true;
$config['display_html'] = true;
$config['strip_exif'] = true;
$config['attachment_reminder'] = true;
$config['max_message_size'] = '25M';
$config['upload_dir'] = '/var/www/html/temp/';
