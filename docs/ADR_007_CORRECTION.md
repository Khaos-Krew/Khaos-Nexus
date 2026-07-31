# ADR-007 Correction Record

ADR-007 originally and incorrectly associated Supabase project `gcdgcftsjorsubutsamh` with the retired Lovable website.

The Owner clarified on GitHub issue #95 that the Lovable website used Lovable-managed cloud services and that the Supabase project is an independent active Khaos Nexus shared service.

The corrected decision is:

- retirement applies only to the deleted Lovable website and archived `Khaos-Krew/chaos-nexus-hub` repository;
- `Khaos-Krew/Khaos-Nexus` remains the sole canonical application repository;
- `Khaos-Krew/Khaos-Nexus-Diagnostics` remains an active supporting runtime;
- Supabase project `gcdgcftsjorsubutsamh` remains active and may be used by explicitly approved application handoffs;
- D&D handoff #94 may continue approved Supabase inspection and implementation;
- website retirement creates no Supabase hold or retention decision requirement;
- destructive Supabase lifecycle actions remain separate decisions requiring explicit scope and Owner approval.

This correction advances the Architecture and Decisions Register from R6 to R7 without changing the website retirement outcome.
