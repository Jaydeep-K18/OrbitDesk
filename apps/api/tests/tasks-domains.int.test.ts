import { beforeAll, describe, expect, it } from 'vitest';
import { as, buildTestApp, registerUser, resetDb, type TestApp, type TestUser } from './helpers.js';

let t: TestApp;
let u: TestUser;
beforeAll(async () => {
  await resetDb();
  t = await buildTestApp();
  u = await registerUser(t.app);
});

describe('tasks CRUD', () => {
  it('creates, lists with cursor pagination, updates and deletes', async () => {
    const api = as(t.app, u.accessToken);
    const created = await api
      .post('/api/v1/tasks')
      .send({
        title: '  Solve 3 LeetCode  ',
        category: 'coding_practice',
        estimateMin: 90,
        dueDate: '2026-10-06',
        tags: ['dsa'],
      })
      .expect(201);
    expect(created.body).toMatchObject({
      title: 'Solve 3 LeetCode',
      category: 'coding_practice',
      status: 'todo',
      estimateMin: 90,
      dueDate: '2026-10-06',
      tags: ['dsa'],
      completedAt: null,
    });
    for (let i = 0; i < 4; i++)
      await api
        .post('/api/v1/tasks')
        .send({ title: `Task ${i}` })
        .expect(201);

    const page1 = await api.get('/api/v1/tasks?limit=2').expect(200);
    expect(page1.body.items).toHaveLength(2);
    expect(page1.body.items[0].title).toBe('Task 3'); // newest first
    const page2 = await api
      .get(`/api/v1/tasks?limit=2&cursor=${page1.body.nextCursor}`)
      .expect(200);
    const page3 = await api
      .get(`/api/v1/tasks?limit=2&cursor=${page2.body.nextCursor}`)
      .expect(200);
    expect(page3.body.items).toHaveLength(1);
    expect(page3.body.nextCursor).toBeNull();

    const done = await api
      .patch(`/api/v1/tasks/${created.body.id}`)
      .send({ status: 'done' })
      .expect(200);
    expect(done.body.completedAt).toBe('2026-10-05T09:00:00.000Z');
    const reopened = await api
      .patch(`/api/v1/tasks/${created.body.id}`)
      .send({ status: 'in_progress' })
      .expect(200);
    expect(reopened.body.completedAt).toBeNull();

    expect((await api.get('/api/v1/tasks?status=in_progress').expect(200)).body.items).toHaveLength(
      1,
    );
    await api.delete(`/api/v1/tasks/${created.body.id}`).expect(204);
    await api.get(`/api/v1/tasks/${created.body.id}`).expect(404);
  });

  it('validates input', async () => {
    const api = as(t.app, u.accessToken);
    await api.post('/api/v1/tasks').send({ title: '' }).expect(422);
    await api.post('/api/v1/tasks').send({ title: 'x', category: 'gaming' }).expect(422);
    await api.post('/api/v1/tasks').send({ title: 'x', dueDate: '2026-13-45' }).expect(422);
    await api
      .patch('/api/v1/tasks/0199a000-0000-7000-8000-000000000999')
      .send({ title: 'x' })
      .expect(404);
    const t1 = await api.post('/api/v1/tasks').send({ title: 'x' }).expect(201);
    await api.patch(`/api/v1/tasks/${t1.body.id}`).send({}).expect(422);
  });
});

describe('domain rules', () => {
  it('normalizes domains and rejects invalid ones', async () => {
    const api = as(t.app, u.accessToken);
    const r = await api
      .post('/api/v1/domain-rules')
      .send({ domain: 'https://WWW.Instagram.com/explore', list: 'blocked' })
      .expect(201);
    expect(r.body).toMatchObject({ host: 'instagram.com', list: 'blocked', scope: '*' });
    // Idempotent upsert.
    const again = await api
      .post('/api/v1/domain-rules')
      .send({ domain: 'instagram.com', list: 'blocked' })
      .expect(201);
    expect(again.body.id).toBe(r.body.id);
    const bad = await api
      .post('/api/v1/domain-rules')
      .send({ domain: 'not a domain', list: 'blocked' })
      .expect(422);
    expect(bad.body.errors[0]).toMatchObject({ path: 'domain' });
  });

  it('prevents the same domain in both global blocked and relevant lists', async () => {
    const api = as(t.app, u.accessToken);
    await api
      .post('/api/v1/domain-rules')
      .send({ domain: 'youtube.com', list: 'relevant' })
      .expect(201);
    const clash = await api
      .post('/api/v1/domain-rules')
      .send({ domain: 'youtube.com', list: 'blocked' })
      .expect(422);
    expect(clash.body.code).toBe('DOMAIN_LIST_CONFLICT');
  });

  it('adds preset packs, skipping domains already marked relevant', async () => {
    const api = as(t.app, u.accessToken);
    await api
      .post('/api/v1/domain-rules')
      .send({ domain: 'reddit.com', list: 'relevant' })
      .expect(201);
    const res = await api.post('/api/v1/domain-rules/presets/social').expect(201);
    const hosts = res.body.items.map((r: { host: string }) => r.host);
    expect(hosts).toContain('tiktok.com');
    expect(hosts).not.toContain('reddit.com');
    expect(res.body.skipped).toBe(1);
    await api.post('/api/v1/domain-rules/presets/unknown').expect(422);

    const blocked = await api.get('/api/v1/domain-rules?list=blocked').expect(200);
    expect(blocked.body.items.every((r: { list: string }) => r.list === 'blocked')).toBe(true);
  });

  it('looks up domain categories', async () => {
    const api = as(t.app, u.accessToken);
    const res = await api.get('/api/v1/domain-categories?host=m.youtube.com').expect(200);
    expect(res.body).toEqual({
      host: 'm.youtube.com',
      registrableDomain: 'youtube.com',
      category: 'video_mixed',
    });
    await api.get('/api/v1/domain-categories?host=%20').expect(422);
  });
});
