# Application Monitor Setup

The Application Monitor can automatically send redacted Khaos Nexus errors to GitHub for triage. Automatic reporting is disabled until it is explicitly enabled.

## Required information

- GitHub repository in `owner/name` format.
- A GitHub fine-grained personal access token.
- Desired issue labels.
- Duplicate suppression period.
- Maximum report deliveries per day.

## Create the GitHub token

Create a fine-grained personal access token for the GitHub account or organization that owns the Khaos Nexus repository.

Recommended access:

- **Resource owner:** `Khaos-Krew`
- **Repository access:** Only the Khaos Nexus repository
- **Repository permissions:**
  - **Issues:** Read and write
  - **Metadata:** Read-only, automatically included by GitHub

The monitor does not need permission to modify repository contents, workflows, pull requests, administration settings, secrets, or deployments.

## Configure Khaos Nexus

1. Open **Application Monitor**.
2. Enter the repository as `Khaos-Krew/Khaos-Nexus-Bot-Manager` until the repository is renamed.
3. Enter labels such as `bug, automated-report`.
4. Keep the duplicate window at 72 hours initially.
5. Keep the daily delivery limit at 10 initially.
6. Paste the fine-grained token.
7. Select **Save Monitor Settings**.
8. Select **Verify GitHub Connection**.
9. Enable **Automatically send redacted errors to GitHub**.
10. Save the monitor settings again.

The token is encrypted with Windows protected storage and is not returned to the screen after saving.

## Reporting behavior

- A new error fingerprint creates a GitHub issue.
- A repeat occurrence inside the duplicate window adds a comment to the existing issue.
- Reports are queued locally while offline or when the token is missing.
- The queue retries every 15 minutes while automatic reporting is enabled.
- The daily limit prevents a crash loop from flooding GitHub.
- If configured labels do not exist, the monitor retries issue creation without labels.

## Information included in reports

- Khaos Nexus version
- Windows version and architecture
- Runtime state and crash count
- Bot heartbeat snapshot
- Stable error ID, message, and stack trace
- Recent redacted application logs
- Public configuration state

Discord tokens, GitHub tokens, and RCON passwords are redacted and excluded.

## After renaming the repository

Update these locations:

1. **Application Monitor → GitHub repository**
2. `package.json` GitHub update provider
3. Default monitor repository in `main/services/config-store.cjs`
4. GitHub issue-report links and documentation

GitHub usually redirects old repository URLs, but explicitly updating the application avoids relying on redirects.

## Operator recovery steps

For a nontechnical operator:

1. Check the Command Center status.
2. Select **Restart** if the bot is offline.
3. Open **Application Monitor** if the status remains red.
4. Confirm the monitor says **Ready** or **Queued**.
5. Use **Send Current Error** if automatic reporting is disabled.
6. Do not delete the local data folder or remove protected tokens unless instructed.
7. Export a backup before changing server or Discord credentials.
