# v0.18.9 validation

Validate that the sandboxed main preload imports only `electron`, exposes `window.khaos` before reporting `startup-health:renderer-ready`, retains preload failures outside the renderer, completes the protected renderer bridge check that was stuck at 68%, preserves the deterministic main-process release controller and 30-second minimum splash, keeps Discord desktop sign-in optional, retains v0.17-compatible data loading, and packages both Windows installer and portable executable.
