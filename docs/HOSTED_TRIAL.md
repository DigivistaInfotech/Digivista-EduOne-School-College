# Private ERP trial

Run the staff pilot first. Give each subsequent school its own HTTPS hostname, API process, database and database credentials. All pilots can use the same release. Keep the repository and runtime files on the operator's server. Only publish the built web directory. Use synthetic data and keep external notifications disabled during evaluation.

The console manages expiry records. It does not provision DNS, databases, HTTPS or hosting accounts. Make a server-only release from a reviewed set of files. The legacy `package_clean_zip.py` is not a deployment packager because it does not exclude every local environment or private trial file.

## Provision a pilot

1. Set up a private release checkout on the host. Install dependencies with `npm ci` and run `npm run build`. Deploy `apps/web/dist` as the static web root. The API runs from the private checkout with `npm run start -w @erp/api`.
2. Create an empty PostgreSQL database named `erp_trial_staff` (use a different suffix for each school), accessible only from the API host. Run `npm run db:migrate` with `DATABASE_URL` pointing to this database. Use the migration operator for schema setup and a dedicated application login for runtime. Restrict each trial's login to its own database, including revoking inherited database access where necessary. Verify the isolation using the actual runtime login.
3. Set `TRIAL_SEED_DATABASE_URL` to the same database using the operator login. Set a unique 32-byte hex `BIOMETRIC_ENCRYPTION_KEY` for the synthetic seed and API. Run `npx tsx scripts/seed-hosted-trial.ts` from a private terminal. The command refuses a populated database. Save the generated unique role logins in a secure store. Avoid running the development seed on a hosted trial.
4. Start the owner-only console with `npm run trial:console` and a unique `TRIAL_CONSOLE_PASSWORD` of at least 20 characters. The console binds to loopback. Access it on the same machine or through an SSH tunnel, and sign in as `owner`. Set `TRIAL_CONSOLE_DIRECTORY` to a private persistent directory. Run one console process per directory. At handover, create a one-month trial for the instance. The console registers the expiry file. Infrastructure and credentials are provisioned separately in the previous steps.
5. Start the API under a service manager with the configuration below and a dedicated service identity. Give each instance a different loopback port. Keep secret values in the service's private environment. Grant the API identity read-only access to its own expiry file and enough directory access to traverse to it. Keep the directory writable only by the console identity. Keep the console, trial files and source outside the web root.

```dotenv
NODE_ENV=production
APP_ORIGIN=https://staff-trial.example.com
API_HOST=127.0.0.1
PORT=4101
COOKIE_SECURE=true
TRIAL_EXPIRY_FILE=/srv/erp/private-trials/staff.json
```

6. Route HTTPS through a reverse proxy. For Caddy, the following illustrates the layout. Keep access private using your VPN or an authenticated gateway before sharing the URL. Never use the development server as the public web root or proxy the trial console publicly.

```caddyfile
staff-trial.example.com {
    @api path /api /api/*
    handle @api {
        reverse_proxy 127.0.0.1:4101
    }
    handle {
        root * /srv/erp/release/apps/web/dist
        try_files {path} /index.html
        file_server
    }
}
```

## Run the pilot on managed Node.js hosting

Use the same database migration and synthetic seed steps. Provision a separate PostgreSQL database that accepts verified TLS connections. Use a connection URL with `sslmode=verify-full`, and verify the runtime database role on the actual provider before attaching the public hostname.

Build with `npm ci` and `npm run build`. Select Node.js 22 or later, `server.js` as the start file, and `apps/web/dist` as the web build output if the host requests it. The start file serves the built web app and API on the provider-assigned `PORT`. Set `NODE_ENV=production`, `API_HOST=0.0.0.0`, `COOKIE_SECURE=true` and `APP_ORIGIN` to the pilot's HTTPS origin. Keep environment values in the provider's secret settings.

Set `MANAGED_TRIAL_PASSWORD` to a unique password of at least 20 characters. Staff enter `staff` and this password at the gateway before signing in with their assigned ERP accounts. Set `TRIAL_EXPIRES_AT` at handover and update it in the host's private settings for renewal. This deployment uses an environment value for expiry so it can run on a host without persistent file storage.

## Set up the live School ERP database

Run `npm run db:migrate` against the `schoolerp` database. To create the first real school and owner, run `npm run db:bootstrap:school` once with `DATABASE_URL`, `SCHOOLERP_SCHOOL_NAME`, `SCHOOLERP_SCHOOL_CODE`, `SCHOOLERP_OWNER_NAME`, `SCHOOLERP_OWNER_EMAIL` and `SCHOOLERP_OWNER_PASSWORD` set through a private terminal or secret store. The command refuses a database that already contains a school or user. It loads role definitions and standard masters, then creates the school and owner in one transaction.

For the live Hostinger site, use `server.js`, the `schoolerp` connection URL with `sslmode=verify-full`, `NODE_ENV=production`, `COOKIE_SECURE=true` and `APP_ORIGIN=https://schoolerp.digivistainfotech.in`. Keep trial environment settings absent from this service. Set up customer demonstrations in a separate database or environment.

Hostinger installs production dependencies for this site. Run `npm ci` and `npm run build` in the release checkout, include `apps/web/dist` in the upload, and set the archive's `build` script to check that `apps/web/dist/index.html` exists. Keep the build tools as development dependencies. Hostinger loads `server.js` using `require()`, so keep that entry free of top-level `await`.

## Verify and hand over

- Verify HTTPS, sign-in, and that only the frontend assets are served. Verify that the API and database ports are inaccessible externally.
- Verify the staff pilot with role-based accounts, including login, attendance, fees, library issue and return, and school data isolation. Approve the pilot internally before issuing the first school link.
- Keep the `main_admin` account with the owner. Share only individual role accounts. Trial mode reserves account and role changes for the owner and blocks assigning the `main_admin` role through the API.
- Before handing over, verify expiry on a disposable instance and test a renewal. The API blocks new and existing sessions at expiry without deleting records. After payment confirmation, use the console to extend that trial by one, two or four calendar months from the later of its expiry and the current date. The API picks up the change without a restart. The browser may still display previously loaded information until refreshed.
- If provisioning without the console, set `TRIAL_EXPIRES_AT` to an explicit UTC ISO timestamp with milliseconds instead of setting `TRIAL_EXPIRY_FILE`. Extending such a pilot requires updating the service environment and restarting it.
- For ten schools, reuse the release and repeat the same setup with a distinct hostname, port, database/login, generated tester credentials and expiry for each school.
