# Reviewing Slash Bot

About ten minutes for the happy path, and a few more if you want to break things.

## Access

| | |
|---|---|
| Dashboard | URL_PENDING_DEPLOY |
| Admin login | REVIEWER_EMAIL_PENDING / REVIEWER_PASSWORD_PENDING (a throwaway account) |
| Test server | INVITE_PENDING |

The test server has `#general` (run commands here), `#alerts` (where reports are posted) and
`#mirror` (the second channel, fed by a Discord webhook).

## 1. Report something

1. In `#general`, run `/report` and press Enter without filling anything in. A form opens.
2. Fill in a title and details, pick a severity and a category, and submit.
3. You get a private receipt, "Report #N received". Within a few seconds it's replaced with
   the AI triage: a summary, category, severity, tags and a suggested next step.
4. `#alerts` gets the report with **Acknowledge** and **Resolve** buttons.
5. `#mirror` gets a one-line copy (by default for medium severity and above; that's a rule
   you can change).

`/report details: something happened severity: High` skips the form and files straight away.

## 2. Use the buttons

In `#alerts`, click **Acknowledge**, then **Resolve**. The message updates in place, and each
change is mirrored to `#mirror`. Changing a report's status needs Manage Messages. In the
test server everyone has it in `#alerts` through a channel override, so you can try the
buttons. Anyone without it gets a private "you need Manage Messages" reply and nothing
changes.

## 3. Run /status

`/status` shows the alert channel, the mirror, whether AI is on, open reports and delivery
health. **Refresh** updates it in place.

## 4. Look at the dashboard

Sign in and open **Test server**.

- **Activity** is the live log, refreshing every few seconds. Click a row to see the report,
  the AI output and every job with its attempt history. **Needs attention** filters to
  anything retrying or failed.
- **Rules** has per-command settings. For example:
  - Set **/status → Who sees the reply** to *Everyone in the channel* and run `/status`
    again: the reply is now public.
  - Set **/report → Post to the alert channel** to *Critical only* and file a low report:
    it's logged and replied to, but not posted.
  - Try saving `moderators` as the ping role ID to see validation.
- **Settings** has the alert channel picker, the mirror (the URL is stored encrypted and
  only a hint is shown) and the testing tools.

## 5. Break things

**Mirror outage and recovery.**

1. Settings → Testing tools → **Simulate a 5 minute outage**.
2. File a `/report` with high severity.
3. In Activity, the Mirror step shows *retrying* with its attempt count and next retry time.
   The report, reply and alert post are unaffected.
4. Click **End outage now**, or wait. Within about a minute the minute sweep retries and the
   step turns into "Recovered after N attempts", with each attempt listed.

**Forged, unsigned and replayed requests:**

```bash
URL=URL_PENDING_DEPLOY/api/discord/interactions

# No signature -> 401 {"error":"missing_signature"}
curl -i -X POST $URL -H 'content-type: application/json' -d '{"type":1}'

# Forged signature -> 401 {"error":"invalid_signature"}
curl -i -X POST $URL -H 'content-type: application/json' \
  -H "x-signature-ed25519: $(printf 'ab%.0s' {1..64})" \
  -H "x-signature-timestamp: $(date +%s)" -d '{"type":1}'

# Garbage -> 401 (the signature is checked before the body is even parsed)
curl -i -X POST $URL -d 'not json'
```

A replayed genuine request would be rejected as `stale_timestamp` after 5 minutes. Inside
that window it would hit the interaction-id primary key and just get the original response
back. The integration tests exercise both, including 8 concurrent copies of one interaction.

**Isolation.** The reviewer account only sees its own servers. Any other server id in the
URL gives the same 404 as one that doesn't exist.

**Health:** `GET URL_PENDING_DEPLOY/api/health` returns database status and how many jobs
are due.

## Adding the bot to your own server

Sign in, click **Connect a server**, and pick a server where you have Manage Server. Then
choose an alert channel and paste a mirror webhook (Slack, or Discord: Channel settings →
Integrations → Webhooks) under Settings. Each server's history, rules and settings are
separate.
