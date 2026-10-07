import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { createOrder } from '../../src/modules/orders/order.service';
import { authHeader, seedAttendee, seedEvent, seedOrganizer } from '../helpers/factories';

const api = request(buildApp());
const DAY = 864e5;
const eventBody = {
  title: 'Detty December', description: 'Big night', venue: 'Landmark', city: 'Lagos',
  startsAt: new Date(Date.now() + 10 * DAY).toISOString(), endsAt: new Date(Date.now() + 11 * DAY).toISOString(),
};
const categoryBody = {
  name: 'Regular', priceMinor: 500_000, capacity: 10,
  salesStartAt: new Date(Date.now() - DAY).toISOString(), salesEndAt: new Date(Date.now() + 9 * DAY).toISOString(),
};

describe('organizer API', () => {
  it('walks draft -> category -> publish -> public listing', async () => {
    const org = await seedOrganizer();
    const h = authHeader(org.id, 'organizer');

    const created = await api.post('/organizer/events').set(h).send(eventBody);
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('DRAFT');
    const id = created.body.id;

    expect((await api.get('/events')).body.items).toHaveLength(0); // drafts are invisible
    expect((await api.post(`/organizer/events/${id}/publish`).set(h)).status).toBe(409); // needs a category

    expect((await api.post(`/organizer/events/${id}/categories`).set(h).send(categoryBody)).status).toBe(201);
    expect((await api.post(`/organizer/events/${id}/categories`).set(h).send(categoryBody)).status).toBe(409); // duplicate name
    expect((await api.post(`/organizer/events/${id}/publish`).set(h)).body.status).toBe('PUBLISHED');

    const list = await api.get('/events?city=lagos');
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].categories[0].available).toBe(10);
  });

  it("hides other organizers' events behind 404", async () => {
    const owner = await seedOrganizer();
    const { event } = await seedEvent(5, { organizerId: owner.id });
    const stranger = authHeader((await seedOrganizer()).id, 'organizer');

    expect((await api.patch(`/organizer/events/${event.id}`).set(stranger).send({ title: 'Hijacked' })).status).toBe(404);
    expect((await api.get(`/organizer/events/${event.id}/summary`).set(stranger)).status).toBe(404);
    expect((await api.post(`/organizer/events/${event.id}/cancel`).set(stranger)).status).toBe(404);
  });

  it('refuses to shrink capacity below tickets already reserved', async () => {
    const org = await seedOrganizer();
    const { event, category } = await seedEvent(10, { organizerId: org.id });
    const buyer = await seedAttendee();
    await createOrder(buyer.id, { eventId: event.id, idempotencyKey: randomUUID(), items: [{ categoryId: category.id, quantity: 4 }] });
    const h = authHeader(org.id, 'organizer');
    const url = `/organizer/events/${event.id}/categories/${category.id}`;

    expect((await api.patch(url).set(h).send({ capacity: 3 })).status).toBe(400);
    expect((await api.patch(url).set(h).send({ capacity: 4 })).status).toBe(200);
    expect((await prisma.ticketCategory.findUniqueOrThrow({ where: { id: category.id } })).available).toBe(0);
  });

  it('cancels an event and reports sales in the summary', async () => {
    const org = await seedOrganizer();
    const { event } = await seedEvent(5, { organizerId: org.id });
    const h = authHeader(org.id, 'organizer');

    const summary = await api.get(`/organizer/events/${event.id}/summary`).set(h);
    expect(summary.body).toMatchObject({ paidOrders: 0, revenueMinor: 0 });

    expect((await api.post(`/organizer/events/${event.id}/cancel`).set(h)).body.status).toBe('CANCELLED');
    expect((await api.post(`/organizer/events/${event.id}/cancel`).set(h)).status).toBe(409);
  });
});