'use strict';

const { PterodactylClient, PterodactylApiError, errorDetail } = require('./pterodactyl-client.cjs');
const { normalizeRemotePath } = require('../../shared/ark-server-control.cjs');

function identifier(value) {
  const id = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw new PterodactylApiError('Invalid Pterodactyl server identifier.', { code: 'INVALID_IDENTIFIER' });
  return id;
}

class PterodactylFileClient extends PterodactylClient {
  async fileContents(serverIdentifier, remotePath) {
    const id = identifier(serverIdentifier);
    const file = normalizeRemotePath(remotePath);
    const payload = await this.request('GET', `servers/${id}/files/contents`, undefined, `?file=${encodeURIComponent(file)}`);
    return typeof payload === 'string' ? payload : JSON.stringify(payload ?? '', null, 2);
  }

  async writeFile(serverIdentifier, remotePath, content) {
    const id = identifier(serverIdentifier);
    const file = normalizeRemotePath(remotePath);
    const endpoint = this.endpoint(`servers/${id}/files/write`, `?file=${encodeURIComponent(file)}`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    timer.unref?.();
    try {
      const response = await this.fetchImpl(endpoint, {
        method: 'POST',
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          Accept: 'Application/vnd.pterodactyl.v1+json',
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'text/plain; charset=utf-8'
        },
        body: String(content ?? '')
      });
      if (!response.ok) {
        const text = await response.text();
        let payload = text;
        try { payload = text ? JSON.parse(text) : null; } catch {}
        const detail = errorDetail(payload);
        if (response.status === 401) throw new PterodactylApiError('Pterodactyl rejected the Client API key.', { status: 401, code: 'AUTH_FAILED', endpoint });
        if (response.status === 403) throw new PterodactylApiError(`The Pterodactyl account does not have file-write permission${detail ? `: ${detail}` : '.'}`, { status: 403, code: 'FORBIDDEN', endpoint });
        if (response.status === 404) throw new PterodactylApiError('The Pterodactyl server or file endpoint was not found.', { status: 404, code: 'NOT_FOUND', endpoint });
        throw new PterodactylApiError(`Pterodactyl file write failed with HTTP ${response.status}${detail ? `: ${detail}` : ''}.`, { status: response.status, code: 'HTTP_ERROR', endpoint });
      }
      return { written: true, remotePath: file };
    } catch (error) {
      if (error instanceof PterodactylApiError) throw error;
      if (error?.name === 'AbortError') throw new PterodactylApiError(`Pterodactyl file write timed out after ${Math.round(this.timeoutMs / 1000)} seconds.`, { code: 'TIMEOUT', endpoint, cause: error });
      throw new PterodactylApiError(`Pterodactyl file write failed: ${error?.message || error}`, { code: 'CONNECTION_FAILED', endpoint, cause: error });
    } finally {
      clearTimeout(timer);
    }
  }
}

module.exports = { PterodactylFileClient, identifier };