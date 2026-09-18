const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || '';

class ApiClient {
  constructor() {
    this.token = null;
  }

  setToken(token) { this.token = token; }

  async _fetch(path, opts = {}) {
    const res = await fetch(`${BACKEND_URL}${path}`, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        ...(opts.headers || {}),
      },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Request failed' }));
      const error = new Error(err.detail || `HTTP ${res.status}`);
      error.status = res.status;
      throw error;
    }
    return res.json();
  }

  async startProcessing(data) {
    return this._fetch('/api/process-video', { method: 'POST', body: JSON.stringify(data) });
  }

  // Re-runs the pipeline against a submission whose video is already uploaded.
  async retrySubmission(submissionId) {
    return this._fetch(`/api/submissions/${submissionId}/retry`, { method: 'POST' });
  }

  // Asks the backend to fail submissions abandoned by a restarted worker.
  async reconcile() {
    return this._fetch('/api/reconcile', { method: 'POST' });
  }

  async getJobStatus(jobId) {
    return this._fetch(`/api/job/${jobId}`);
  }

  async getSubmissions() {
    return this._fetch('/api/submissions');
  }

  async healthCheck() {
    return this._fetch('/health');
  }

  /**
   * Poll a job to completion.
   *
   * A 404 means the job record is gone — the worker restarted, or Redis
   * dropped it. Retrying forever would hang the UI on a job that no longer
   * exists, so a short grace period covers a transient blip and anything
   * beyond that is reported as a failure the user can retry from.
   */
  waitForCompletion(jobId, onProgress = () => {}, interval = 2000) {
    return new Promise((resolve, reject) => {
      let missing = 0;
      const MAX_MISSING = 3;

      const poll = async () => {
        try {
          const s = await this.getJobStatus(jobId);
          missing = 0;
          onProgress(s);
          if (s.status === 'completed') resolve(s);
          else if (s.status === 'failed') reject(new Error(s.error || 'Processing failed'));
          else setTimeout(poll, interval);
        } catch (e) {
          if (e.status === 404 && ++missing <= MAX_MISSING) {
            setTimeout(poll, interval);
            return;
          }
          reject(e);
        }
      };
      poll();
    });
  }
}

export const api = new ApiClient();
