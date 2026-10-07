import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import { seedAttendee, seedOrganizer, authHeader } from '../helpers/factories';

const api = request(buildApp());
const creds = { email: 'Ada@Test.io', password: 'password123', fullName: 'Ada Obi' };

describe('auth', () => {
  it('registers, logs in, and rejects duplicates and bad credentials', async () => {
    const reg = await api.post('/auth/attendees/register').send(creds);
    expect(reg.status).toBe(201);
    expect(reg.body.token).toBeTruthy();
    expect(reg.body.attendee.passwordHash).toBeUndefined();

    expect((await api.post('/auth/attendees/register').send({ ...creds, email: 'ada@test.io' })).status).toBe(409);
    expect((await api.post('/auth/attendees/login').send({ email: 'ada@test.io', password: 'password123' })).status).toBe(200);
    expect((await api.post('/auth/attendees/login').send({ email: 'ada@test.io', password: 'wrong-password' })).status).toBe(401);
    expect((await api.post('/auth/attendees/login').send({ email: 'nobody@test.io', password: 'password123' })).status).toBe(401);
    expect((await api.post('/auth/attendees/register').send({ email: 'x@test.io', password: 'short' })).status).toBe(422);
  });

  it('keeps attendee and organizer roles separate', async () => {
    const attendee = await seedAttendee();
    const organizer = await seedOrganizer();

    expect((await api.get('/orders')).status).toBe(401);
    expect((await api.get('/orders').set('Authorization', 'Bearer garbage')).status).toBe(401);
    expect((await api.get('/orders').set(authHeader(organizer.id, 'organizer'))).status).toBe(403);
    expect((await api.get('/organizer/events').set(authHeader(attendee.id, 'attendee'))).status).toBe(403);
    expect((await api.get('/organizer/events').set(authHeader(organizer.id, 'organizer'))).status).toBe(200);
    expect((await api.get('/auth/me').set(authHeader(attendee.id, 'attendee'))).body.role).toBe('attendee');
  });
});