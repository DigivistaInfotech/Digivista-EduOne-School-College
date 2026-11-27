# Password reset email setup

The production login exposes a **Forgot your password?** flow. The API issues a random, single-use token that expires after 30 minutes and emails a link to the registered email address. The token is stored hashed, account existence is not disclosed, and the token is invalidated if email delivery fails.

## Hostinger Email settings

In hPanel, open **Websites → schoolerp.digivistainfotech.in → Manage → Environment variables** and add:

| Key                     | Value                                                                                         |
| ----------------------- | --------------------------------------------------------------------------------------------- |
| `SMTP_HOST`             | `smtp.hostinger.com`                                                                          |
| `SMTP_PORT`             | `465`                                                                                         |
| `SMTP_SECURE`           | `true`                                                                                        |
| `SMTP_USER`             | The full sender mailbox address                                                               |
| `SMTP_PASSWORD`         | That mailbox's password                                                                       |
| `SMTP_FROM`             | The same sender mailbox address                                                               |
| `APP_ORIGIN`            | `https://schoolerp.digivistainfotech.in`                                                      |
| `ADMIN_RECOVERY_SECRET` | A randomly generated value of at least 32 characters; configure only during an owner recovery |

Hostinger's current email configuration uses `smtp.hostinger.com` on port `465` with SSL. If port 465 is unavailable for the account, use port `587` with `SMTP_SECURE=false` (STARTTLS).

Save the variables and restart the Node.js app. `APP_ORIGIN` makes emailed links point to the live ERP instead of the local development address. Do not put mailbox credentials in source control, `.env.example`, or chat. Do not replace the full environment variable set unless all existing values are available; Hostinger's bulk replace removes omitted variables.

## Recovery behavior

- Before SMTP is configured, the reset request returns a generic service-unavailable message and does not create a reset token.
- After SMTP is configured, the response is generic whether or not the account exists. A valid account receives an email; unknown accounts do not receive mail.
- The recipient opens the emailed link, chooses a new password, and the token can only be used once.
- The email address must already be registered. Account creation and role assignment remain a separate administrator-controlled step.

## One-time Digivista admin recovery

If neither owner can sign in, first configure and verify SMTP, then temporarily set `ADMIN_BOOTSTRAP_SECRET` in Hostinger to a randomly generated value of at least 32 characters. The one-time endpoint `POST /api/auth/bootstrap-digivista-admins` accepts that value only in the `x-admin-bootstrap-secret` header. It is hard-limited to the two owner addresses approved for this recovery, assigns `main_admin` at school scope for each active institution in this database, and sends each recipient a password setup link. New records stay `invited` until the emailed token is used. Existing disabled or locked accounts are not reactivated.

After the endpoint returns both account IDs, remove `ADMIN_BOOTSTRAP_SECRET` from Hostinger and restart the app. A database audit marker prevents the one-time action from running again.

## Owner recovery without email

The login page also exposes **Digivista owner recovery**. This is restricted to the two approved Digivista owner email addresses. It requires a temporary `ADMIN_RECOVERY_SECRET` (at least 32 characters) configured in Hostinger and lets the owner enter a new password and confirmation directly. Each owner account can use this recovery once; the change is audited, active sessions are revoked, and school-scoped `main_admin` access is ensured. Remove `ADMIN_RECOVERY_SECRET` from Hostinger after use and restart the app. The regular email recovery remains available.
