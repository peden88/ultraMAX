# Dockhand staging against existing production providers

**Scope:** The ultraMAX staging container and its config volume are isolated; AIOStreams and AIOMetadata remain shared production services. Only disposable users may be created. Do not merge or deploy production ultraMAX.

## Dockhand setup

1. Add a **new Git-backed stack** pointing at `peden88/ultraMAX`, branch `ultramax-hardening`, Compose file `compose.staging.yaml`. Do not replace an existing stack.
2. In Dockhand's environment editor set the variables referenced by the Compose file. Mandatory: `TMDB_KEY`, `AIOSTREAMS_BASE_URL`, `AIOMETADATA_BASE_URL`, `ULTRAMAX_ENCRYPTION_KEY`, `ULTRAMAX_SERVICES_MASTER_KEY`. Add `AIOMETADATA_ADDON_PASSWORD` if required by the current AIOMetadata server. Generate two *different*, independent random staging keys, and retain them securely across restarts. Never reuse production secrets.
3. Prefer the internal provider hostnames/ports reachable from `pangolin_frontend`. Verify both providers are attached to that network before attempting provisioning. Do not invent ports or addresses; inspect the running Compose/network configuration.
4. Add a *new*, access-restricted Pangolin staging hostname routed to `ultramax-staging:7000`. The staging container publishes no host ports.
5. Inspect the rendered Dockhand Compose configuration and ensure there are no production ultraMAX mounts, shared `configs.json`, or container-name collisions. Only then deploy this staging stack.
6. Verify `/health`, container health, logs, and empty staging configuration. Create a new ultraMAX catalog config and disposable backend accounts using unique test identifiers. Record created account IDs privately for later cleanup.
7. Check `/c/<token>/services/status` and `/c/<token>/services/check` with the staging config password. Verify both backend manifests and a sample metadata/stream response. Retry the same test secret and confirm account IDs do not change. Test a changed secret and expect rejection (409 at provider level); do not rotate credentials in production.
8. For failure testing, use mocks or deliberately invalid **staging** endpoints, not a production outage. Do not delete, update, or reset existing production accounts.
9. Roll back by stopping/removing only the staging stack. Keep the staging volume until disposable backend accounts have been identified and cleaned up safely.

## Safety notes

- AIOStreams and AIOMetadata are shared: even disposable account creation writes to production databases.
- `ultramax_staging_data` is a separate named volume; it must not be mounted by any production ultraMAX container.
- `ULTRAMAX_CONFIGS_FILE=/data/configs.json` keeps staging user configuration separate.
- A Git-backed Dockhand stack requires build context support. Confirm Dockhand checks out the repository into the build context; otherwise use a separate source checkout and a Compose stack that references that directory.
- This is a preparation document, not a record of a deployment or successful live-provider test.
