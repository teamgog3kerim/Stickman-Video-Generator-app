---
name: EthioDeploy secret flags
description: A CLI-version mismatch encountered while configuring EthioDeploy variables for this project.
---

The installed EthioDeploy CLI accepted `env set --sensitive` but rejected the documented `--runtime-only` option. The app's current secrets are not read by the build.

**Why:** the workspace CLI's help output did not match the current online docs.

**How to apply:** check `ethiodeploy env set --help` before relying on optional flags; keep secrets out of build inputs and logs if runtime-only storage is unavailable.
