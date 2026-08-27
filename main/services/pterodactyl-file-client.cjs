'use strict';

const { PterodactylClient, PterodactylApiError, errorDetail } = require('./pterodactyl-client.cjs');
const { normalizeRemotePath } = require('../../shared/ark-server-control.cjs');

function identifier(value) {
  const id = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw new PterodactylApiError('Invalid Pterodactyl server identifier.', { code: 'INVALID_IDENTIFIER' });
  return id;
}

class PterodactylFileClient extends PterodactylClient {
  async rawFileRequest(method, serverIdentifier, remotePath, content) {
    const id = identifier(serverIdentifier);
    const file = normalizeRemotePath(remotePath);
    const route = method === 'GET' ? 'contents' : 'write';
    const endpoint = this.endpoint(`servers/${id}/files/${route}`, `?file=${encodeURIComponent(file)}`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    timer.unref?.();
    try {
      const response = await this.fetchImpl(endpoint, {
        method,
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          Accept: 'text/plain, application/json',
          Authorization: `Bearer ${this.token}`,
          ...(method === 'POST' ? { 'Content-Type': 'text/plain; charset=utf-8' } : {})
        },
        ...(method === 'POST' ? { body: String(content ?? '') } : {})
      });
      const text = await response.text();
      if (!response.ok) {
        let payload = text;
        try { payload = text ? JSON.parse(text) : null; } catch {}
        const detail = errorDetail(payload);
        if (response.status === 401) throw new PterodactylApiError('Pterodactyl rejected the Client API key.', { status: 401, code: 'AUTH_FAILED', endpoint });
        if (response.status === 403) throw new PterodactylApiError(`The Pterodactyl account does not have file permission${detail ? `: ${detail}` : '.'}`, { status: 403, code: 'FORBIDDEN', endpoint });
        if (response.status === 404) throw new PterodactylApiError('The Pterodactyl server or file endpoint was not found.', { status: 404, code: 'NOT_FOUND', endpoint });
        throw new PterodactylApiError(`Pterodactyl file request failed with HTTP ${response.status}${detail ? `: ${detail}` : ''}.`, { status: response.status, code: 'HTTP_ERROR', endpoint });
      }
      return method === 'GET' ? text : { written: true, remotePath: file };
    } catch (error) {
      if (error instanceof PterodactylApiError) throw error;
      if (error?.name === 'AbortError') throw new PterodactylApiError(`Pterodactyl file request timed out after ${Math.round(this.timeoutMs / 1000)} seconds.`, { code: 'TIMEOUT', endpoint, cause: error });
      throw new PterodactylApiError(`Pterodactyl file request failed: ${error?.message || error}`, { code: 'CONNECTION_FAILED', endpoint, cause: error });
    } finally {
      clearTimeout(timer);
    }
  }

  fileContents(serverIdentifier, remotePath) { return this.rawFileRequest('GET', serverIdentifier, remotePath); }
  writeFile(serverIdentifier, remotePath, content) { return this.rawFileRequest('POST', serverIdentifier, remotePath, content); }
}

module.exports = { PterodactylFileClient, identifier };