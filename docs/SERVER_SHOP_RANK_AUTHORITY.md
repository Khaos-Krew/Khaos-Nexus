# Discord Server Shop rank authority

Khaos Nexus currently uses Discord **Server Shop Premium Roles** for the paid Nexus ranks. These products live on the Discord server itself; they are not Premium App SKUs owned by the Nexus Sentinal application.

## Authority rules

- Shadow Recruit remains the free/default Nexus baseline role.
- Cipher Runner, Nexus Raider, Khaos Warden, Blackout Legend, and Origin Founder are paid Server Shop roles.
- When no paid `discord.rankSkus` mappings are configured, Sentinal treats Discord Server Shop roles as authoritative.
- In Server Shop mode, Premium App SKU discovery is not required for acceptance.
- In Server Shop mode, Nexus rank reconciliation owns only the Shadow Recruit baseline. Paid Server Shop roles are excluded from Nexus add/remove reconciliation so a linked paid member cannot be downgraded because the Sentinal application has no Premium App entitlement.
- If paid `discord.rankSkus` mappings are deliberately configured later, authority switches to Premium App entitlement mode and normal SKU/entitlement reconciliation applies.

This distinction is intentional: Discord Server Shop Premium Roles and Discord Premium App SKUs are separate monetization surfaces and must not be treated as interchangeable identifiers.
