import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
}

/** JSON-safe copy (Dates → ISO strings, Decimals → strings, undefined dropped). */
const snapshot = (value: unknown) =>
  value === undefined || value === null ? undefined : (JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue);

// Every admin write is recorded in the same transaction as the change
// itself (ARCHITECTURE.md security baseline): no change without a trail.
@Injectable()
export class AuditService {
  log(tx: Prisma.TransactionClient, actorId: string, entry: AuditEntry) {
    return tx.auditLog.create({
      data: {
        actorId,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        before: snapshot(entry.before),
        after: snapshot(entry.after),
      },
    });
  }
}
