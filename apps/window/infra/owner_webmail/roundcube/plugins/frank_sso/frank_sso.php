<?php

/**
 * Frank owner workspace: single-use launch session for the owner mailbox.
 *
 * Frank authenticates the owner at the identity layer. The launch broker in
 * this component turns that authenticated request into a single-use,
 * short-lived launch cookie. This plugin redeems the cookie exactly once
 * through the broker's internal consume endpoint and then hands the mailbox
 * credential to Roundcube through the stock 'authenticate' hook.
 *
 * Only documented Roundcube extension points are used: 'startup' to route an
 * unauthenticated page load into the login action, 'authenticate' to supply
 * host/user/pass, and 'login_after' to reconcile sender identities. This
 * follows the upstream plugins/autologon sample, with a broker-issued one-use
 * token in place of a source-address check.
 *
 * The mailbox credential is read from the process environment. It never
 * reaches a cookie, a URL, a template, a frame message or a log.
 *
 * @license GNU GPLv3+
 */

class frank_sso extends rcube_plugin
{
    /** Cookie set by the launch broker. */
    private const LAUNCH_COOKIE = 'frank_launch';

    /** Consume result for this request, or null when there is nothing to redeem. */
    private ?array $redemption = null;

    #[\Override]
    public function init()
    {
        $this->add_hook('startup', [$this, 'startup']);
        $this->add_hook('authenticate', [$this, 'authenticate']);
        $this->add_hook('login_after', [$this, 'login_after']);
        $this->add_hook('logout_after', [$this, 'logout_after']);
    }

    /**
     * Route an unauthenticated page load that carries a launch cookie into the
     * login action. Roundcube already forces the task to 'login' when there is
     * no user session, so only the action has to change.
     */
    public function startup($args)
    {
        if (!empty($_SESSION['user_id'])) {
            return $args;
        }

        $this->redemption = $this->redeem();
        if ($this->redemption !== null) {
            $args['action'] = 'login';
        }

        return $args;
    }

    /**
     * Supply the mailbox identity for a redeemed launch token.
     */
    public function authenticate($args)
    {
        if ($this->redemption === null) {
            return $args;
        }

        $base_url = $this->launch_base_url();
        if ($base_url === null) {
            $this->fail('frank_sso: OWNER_WEBMAIL_LAUNCH_URL is not configured');
            return $args;
        }

        $imap_user = $this->env('OWNER_WEBMAIL_IMAP_USER');
        $imap_pass = $this->env('OWNER_WEBMAIL_IMAP_PASSWORD');

        if ($imap_user === '' || $imap_pass === '') {
            $this->fail('frank_sso: mailbox credential is not provisioned');
            return $args;
        }

        // The broker binds the token to the mailbox this deployment configures.
        // A mismatch means the token was minted for something else: refuse.
        $expected_mailbox = $this->env('OWNER_WEBMAIL_MAILBOX');
        $reported = (string) ($this->redemption['mailbox'] ?? '');
        if ($expected_mailbox !== '' && $reported !== '' && !hash_equals($expected_mailbox, $reported)) {
            $this->fail('frank_sso: launch token was issued for a different mailbox');
            return $args;
        }

        $imap_host = $this->env('OWNER_WEBMAIL_IMAP_HOST');
        $args['user'] = $imap_user;
        $args['pass'] = $imap_pass;
        if ($imap_host !== '') {
            $args['host'] = $imap_host;
        }
        $args['cookiecheck'] = false;
        $args['valid'] = true;

        return $args;
    }

    /**
     * Reconcile the configured sender aliases through Roundcube's own identity
     * API, so the owner can send as every address the mailbox owns without
     * hand-editing the client database.
     */
    public function login_after($args)
    {
        $wanted = $this->configured_identities();
        $user = $this->rcmail->user ?? null;
        if (!$wanted || !$user || empty($user->ID)) {
            return $args;
        }

        $existing = [];
        foreach ((array) $user->list_identities() as $identity) {
            $existing[strtolower((string) $identity['email'])] = true;
        }

        $default_name = $this->env('OWNER_WEBMAIL_DISPLAY_NAME');
        $first = empty($existing);

        foreach ($wanted as $address) {
            if (isset($existing[strtolower($address)])) {
                continue;
            }
            $user->insert_identity([
                'standard' => $first ? 1 : 0,
                'name' => $default_name !== '' ? $default_name : $address,
                'email' => $address,
                'signature' => '',
                'html_signature' => 0,
            ]);
            $first = false;
        }

        return $args;
    }

    /**
     * Drop the launch cookie once it has been spent.
     */
    public function logout_after($args)
    {
        $this->clear_launch_cookie();
        return $args;
    }

    private function fail(string $message): void
    {
        rcube::raise_error(['code' => 600, 'file' => __FILE__, 'line' => __LINE__, 'message' => $message], true, false);
    }

    private function env(string $name): string
    {
        $value = getenv($name);
        return $value === false ? '' : trim((string) $value);
    }

    /** @return list<string> */
    private function configured_identities(): array
    {
        $raw = $this->env('OWNER_WEBMAIL_IDENTITIES');
        if ($raw === '') {
            return [];
        }
        $addresses = [];
        foreach (explode(',', $raw) as $candidate) {
            $candidate = trim($candidate);
            if ($candidate !== '' && filter_var($candidate, FILTER_VALIDATE_EMAIL)) {
                $addresses[] = $candidate;
            }
        }
        return array_values(array_unique($addresses));
    }

    private function launch_base_url(): ?string
    {
        $url = $this->env('OWNER_WEBMAIL_LAUNCH_URL');
        return $url === '' ? null : rtrim($url, '/');
    }

    /**
     * Exchange the launch cookie for a redeemed token record. Exactly one
     * caller can succeed; the broker answers 410 Gone for every later attempt.
     */
    private function redeem(): ?array
    {
        $token = (string) ($_COOKIE[self::LAUNCH_COOKIE] ?? '');
        if ($token === '' || strlen($token) > 128) {
            return null;
        }

        $base_url = $this->launch_base_url();
        $secret = $this->env('OWNER_WEBMAIL_CONSUME_SECRET');
        if ($base_url === null || $secret === '') {
            return null;
        }

        $body = json_encode(['token' => $token]);
        $context = stream_context_create([
            'http' => [
                'method' => 'POST',
                'header' => implode("\r\n", [
                    'Content-Type: application/json',
                    'Content-Length: ' . strlen($body),
                    'X-Owner-Webmail-Consume: ' . $secret,
                ]),
                'content' => $body,
                'timeout' => 5,
                'ignore_errors' => true,
            ],
        ]);

        $response = @file_get_contents($base_url . '/internal/consume', false, $context);
        if ($response === false) {
            $this->fail('frank_sso: launch broker is unreachable');
            return null;
        }

        $decoded = json_decode($response, true);
        if (!is_array($decoded) || empty($decoded['ok'])) {
            // Expired, already used or forged. Leave the normal login page up.
            $this->clear_launch_cookie();
            return null;
        }

        return $decoded;
    }

    private function clear_launch_cookie(): void
    {
        if (empty($_COOKIE[self::LAUNCH_COOKIE])) {
            return;
        }
        setcookie(self::LAUNCH_COOKIE, '', [
            'expires' => time() - 3600,
            'path' => '/',
            'secure' => true,
            'httponly' => true,
            'samesite' => $this->env('OWNER_WEBMAIL_COOKIE_SAMESITE') ?: 'Lax',
        ]);
        unset($_COOKIE[self::LAUNCH_COOKIE]);
    }
}
