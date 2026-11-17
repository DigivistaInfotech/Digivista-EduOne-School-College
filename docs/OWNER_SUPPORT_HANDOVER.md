# ERP owner support handover

The deployed ERP uses a web build, a Node.js API and PostgreSQL. An operator can start, stop, maintain and update it with standard server access. The core runtime has no Codex or ChatGPT account requirement. The Hostinger plan, DNS, TLS, database and any separately configured notification provider have their own lifecycles. An ERP trial expiry only controls its own trial instance.

## Keep these under the business owner's control

| Item | What to retain |
| --- | --- |
| Hosting and domain | Owner account, recovery methods, billing renewal and access for a named backup operator |
| Source and releases | Private repository, lockfile, migration history, tagged releases, previous release and a tested deployment procedure |
| Infrastructure | Hostnames, proxy configuration, service names, database names, restore commands and who maintains each item |
| Secrets | Vault entries for SSH, database, ERP owner accounts, trial console and encryption keys. Share individual, limited access with support staff. |
| Backups | Encrypted database backups separate from the host, plus deployment configuration and expiry records. Keep recoverable encryption keys separately. |
| Support | One named responder and one backup. School tickets should state the time, affected role and workflow. Request sanitized screenshots or reproduction steps. |

## When a school reports an outage

1. Check whether the HTTPS login page opens, whether the problem affects one school or every school, and whether the trial has expired. Check DNS, certificate expiry and Hostinger service status when the page cannot be reached.
2. Check the API health endpoint and the service manager. A degraded database result calls for checking the PostgreSQL service, connectivity, disk space and the database logs. A working API with one failed action calls for reproducing it with the affected role on synthetic data.
3. Record the release and incident time. Save sanitized logs before restarting a failed service. Restart the affected service and verify sign-in and the failed workflow. Repeated failures need diagnosis before more restarts.
4. If an update introduced the failure, use the last release compatible with the current schema. For a database failure, restore a backup into an isolated database first, verify record counts and key workflows, and have the owner approve any cutover that could discard newer records.

## Before customer handover

- Verify access with the owner and backup operator from their own accounts. Save emergency access in the owner's vault.
- Schedule PostgreSQL backups and enable disk, uptime and certificate alerts. Perform a restore drill on the actual hosting stack. Record the data that can be recovered and the time the drill took.
- Rehearse rebuilding a test instance from the tagged release, migrations, configuration and backup. Confirm that an operator can do it without Codex access.
- Test role sign-ins, owner-only trial administration, expiry and renewal, plus representative attendance, fees, library and results workflows. Agree who can authorize production changes and when the school will be notified.

See [Private ERP trial](HOSTED_TRIAL.md) for per-school provisioning and renewal. A hosted recovery drill and school handover still need a provisioned host.
