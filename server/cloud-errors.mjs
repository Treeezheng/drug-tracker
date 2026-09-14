export class CloudError extends Error {
  constructor(status, message, details = {}) { super(message); this.name = 'CloudError'; this.status = status; Object.assign(this, details); }
}
