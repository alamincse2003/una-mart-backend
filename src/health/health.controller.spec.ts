import { HttpStatus } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import type { PrismaService } from '../prisma/prisma.service.js';

function fakeResponse() {
  return { status: vi.fn() } as unknown as Parameters<HealthController['check']>[0];
}

describe('HealthController', () => {
  it('reports ok when the database answers', async () => {
    const prisma = { $queryRaw: vi.fn().mockResolvedValue([{ ok: 1 }]) };
    const controller = new HealthController(prisma as unknown as PrismaService);
    const res = fakeResponse();

    await expect(controller.check(res)).resolves.toMatchObject({ status: 'ok', database: 'up' });
    expect(res.status).not.toHaveBeenCalled();
  });

  it('reports 503 when the database is down', async () => {
    const prisma = { $queryRaw: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) };
    const controller = new HealthController(prisma as unknown as PrismaService);
    const res = fakeResponse();

    await expect(controller.check(res)).resolves.toMatchObject({
      status: 'degraded',
      database: 'down',
    });
    expect(res.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
  });
});
