# Khaos Nexus Economy Bridge

A deliberately narrow ARK: Survival Ascended Server API plugin used by Nexus Sentinel for economy operations that ArkShop cannot safely enforce through JSON configuration alone.

## Scope

The bridge exposes only:

- `NexusEconomy.Ping`
- `NexusEconomy.Sell <EOS_ID> <Blueprint> <Amount> <Payout> <TransactionId>`

`Sell` performs one server-side transaction:

1. Resolve the online player by EOS ID.
2. Count only removable, non-engram inventory items whose exact blueprint equals the requested blueprint.
3. Refuse if the exact quantity is unavailable.
4. Remove exactly the requested amount, preserving partial stacks.
5. Credit Nexus Points through ArkShop's exported `Points::AddPoints` API.
6. If point credit fails, restore the exact removed item quantity before returning an error.
7. Return a machine-readable `NEXUS_OK` / `NEXUS_ERR` result to RCON.

Sentinel reserves daily/weekly quota before calling the bridge. Any ambiguous RCON result is placed in manual review and is never automatically retried.

## Version contract

Build/test target:

- ASA Server API: **2.03** (`ArkServerApi/AsaApi`, release commit `86bd3b2`)
- Official ASA Plugins source baseline: `ArkServerApi/ASA-Plugins@622b3c1c1e29c2c972e44620e4e3b9b878e19af4`
- Runtime dependency: ArkShop

Do not silently rebuild against a newer API/ArkShop revision. Update the pinned versions, review API changes, rebuild, and repeat server-side validation first.

## Build prerequisites

Windows / Visual Studio 2022 with the x64 C++ workload and v143 toolset.

The MSVC project expects two paths:

- `ASA_API_ROOT`: root containing `AsaApi/AsaApi/Core/Public` and `AsaApi/out_lib/AsaApi.lib`
- `ARKSHOP_SDK_ROOT`: folder containing `Public/Points.h` and `Lib/ArkShop.lib` produced from the exact ArkShop revision being deployed

Build:

```powershell
msbuild .\NexusEconomyBridge.sln /m /p:Configuration=Release /p:Platform=x64
```

Expected output:

```text
out/NexusEconomyBridge.dll
out/NexusEconomyBridge.pdb
```

## Installation layout

Do not install until the live ArkShop/API versions are verified.

```text
ShooterGame/Binaries/Win64/ArkApi/Plugins/NexusEconomyBridge/
  NexusEconomyBridge.dll
  PluginInfo.json
```

After installation, first validation is read-only:

```text
NexusEconomy.Ping
```

Expected response:

```text
NEXUS_OK bridge=0.1.0 api=2.03
```

Only then should a controlled test account perform a single low-value sell transaction.

## Safety constraints

- No `ClearPlayerInventory`.
- No `DestroyAll`.
- No arbitrary console command executor.
- Exact blueprint equality only.
- Bounded amount and payout arguments.
- Online player required.
- Point-credit failure attempts exact inventory restoration.
- Sentinel dynamic sell feature remains disabled unless `NEXUS_ARK_DYNAMIC_SELL_ENABLED=true`.
- MX-E Sell tab remains disabled until MySQL sharing, the bridge, and a controlled transaction test are all verified.

## Known pre-production requirement

The bridge intentionally links to ArkShop's exported point API for atomic item-removal/credit rollback semantics. A matching `ArkShop.lib` import library must be produced from the same ArkShop build/revision as the server's `ArkShop.dll`. This is a build/deployment requirement, not something Sentinel should guess around.
