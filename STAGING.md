# Isolated ultraMAX staging

Use only a checkout of `ultramax-hardening`. Do not merge this branch or mount production `configs.json`.

1. In Dockhand create a separate staging stack from `compose.staging.yaml`. Its build context must include this repository checkout.
2. Copy `.env.staging.example` to `.env.staging` **locally**. Fill required `TMDB_KEY`, staging provider URLs and independent encryption/master keys. Do not commit the filled file.
3. Connect the stack to the existing `pangolin_frontend` network. Route a **new staging hostname** to `ultramax-staging:7000` in Pangolin. Keep access restricted to testers.
4. Build/start only the staging stack. Confirm `/health` responds with HTTP 200 and `docker inspect ultramax-staging` reports healthy.
5. Use a disposable test account. Create catalogs, provision test AIOStreams/AIOMetadata users, verify both status endpoints, generated manifest, catalog and stream/meta requests, repeat provisioning, and a deliberate provider outage.
6. Check that staging data is stored only in the named `ultramax_staging_data` volume. Do not connect production provider endpoints unless isolated test-user creation and cleanup have been explicitly approved.
7. Roll back by stopping/removing the staging stack; preserve its volume for investigation or delete it deliberately after tests.

This staging compose exposes **no host ports** and shares **no production configuration volume**. It does not deploy itself.
